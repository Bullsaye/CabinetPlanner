import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type App } from "../src/app.ts";
import { fromEnv, type ServerConfig } from "../src/config.ts";
import { MIGRATIONS } from "../src/db.ts";
import { compareVersions } from "../src/packs.ts";

const shop = JSON.parse(readFileSync(new URL("../../../examples/shop.json", import.meta.url), "utf8"));

interface Res {
  status: number;
  body: any;
  headers: Headers;
}

/** A server on an ephemeral port with an in-memory database and a clock the test moves. */
async function start(overrides: Partial<ServerConfig> = {}): Promise<{ app: App; url: string; clock: { now: number }; logs: string[]; call: Call }> {
  const clock = { now: Date.UTC(2026, 10, 9, 12) };
  const logs: string[] = [];
  const app = createApp({
    port: 0,
    host: "127.0.0.1",
    dataDir: ":memory:",
    adminEmails: ["admin@example.com"],
    now: () => clock.now,
    log: (l) => logs.push(l),
    rateLimits: { auth: { burst: 1000, perMinute: 1000 }, publish: { burst: 1000, perMinute: 1000 } },
    ...overrides,
  });
  const url = await app.listen();
  const call: Call = async (method, path, body, token, headers = {}) => {
    const res = await fetch(url + path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
  };
  return { app, url, clock, logs, call };
}
type Call = (method: string, path: string, body?: unknown, token?: string | null, headers?: Record<string, string>) => Promise<Res>;

const PASSWORD = "correct horse battery";
async function register(call: Call, name: string, email = `${name.toLowerCase()}@example.com`): Promise<{ token: string; id: string }> {
  const r = await call("POST", "/api/auth/register", { email, password: PASSWORD, displayName: name });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { token: r.body.token, id: r.body.user.id };
}

const preset = (id: string): Record<string, unknown> => ({ id, name: { en: `Preset ${id}`, de: `Voreinstellung ${id}` }, group: "construction", vars: { front_gap: 3 }, options: { back_mount: "groove" } });
const template = (id: string): Record<string, unknown> => ({ id, name: `Template ${id}`, cabinet: { kind: "base", presets: ["base-unit"], vars: { W: 600 }, fronts: [{ type: "drawer", h: 150 }, { type: "door" }] } });
const pack = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: "Dowel 32 construction",
  description: "Sides over bottom, back in a groove.",
  tags: ["dowel", "32mm"],
  version: "1.0.0",
  changelog: "First release",
  content: { presets: [preset("p1")], templates: [template("t1")] },
  ...over,
});

describe("server basics", () => {
  let s: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => void (s = await start()));
  afterAll(() => s.app.close());

  it("answers /health and applies all migrations", async () => {
    const r = await s.call("GET", "/health");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, api: 1 });
    expect(r.body.licences[0]).toBe("CC-BY-4.0");
    expect(s.app.db.version).toBe(MIGRATIONS.length);
  });

  it("answers CORS preflight and allows any origin by default", async () => {
    const r = await s.call("OPTIONS", "/api/auth/login", undefined, null, { Origin: "tauri://localhost", "Access-Control-Request-Method": "POST" });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("returns uniform JSON errors", async () => {
    const missing = await s.call("GET", "/api/nope");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: { code: "not_found", message: expect.any(String) } });
    expect((await s.call("DELETE", "/health")).body.error.code).toBe("method_not_allowed");
    const bad = await s.call("POST", "/api/auth/login", "{not json");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("invalid_json");
    const invalid = await s.call("POST", "/api/auth/login", { email: 5 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("bad_request");
    expect(invalid.body.details[0].path).toBe("email");
  });

  it("rejects bodies over the limit", async () => {
    const r = await s.call("POST", "/api/auth/login", { email: "a@example.com", password: "x".repeat(70_000) });
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe("payload_too_large");
  });

  it("hides internals on unexpected errors", async () => {
    const t = await start();
    const a = await register(t.call, "Crash");
    const b = await register(t.call, "Reporter");
    const p = await t.call("POST", "/api/packs", pack(), a.token);
    t.app.db.raw.exec("DROP TABLE reports");
    const r = await t.call("POST", `/api/packs/${p.body.pack.id}/reports`, { reason: "Wrong bore depth" }, b.token);
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: { code: "internal", message: "Internal server error" } });
    expect(t.logs.join("\n")).toContain("no such table");
    await t.app.close();
  });

  it("restricts CORS to the configured origins", async () => {
    const t = await start({ corsOrigins: ["https://planner.example"] });
    const ok = await t.call("GET", "/health", undefined, null, { Origin: "https://planner.example" });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://planner.example");
    const other = await t.call("GET", "/health", undefined, null, { Origin: "https://evil.example" });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    await t.app.close();
  });

  it("reads the configuration from the environment", () => {
    const c = fromEnv({ PORT: "9000", DATA_DIR: "/data", ADMIN_EMAILS: "Jo@Example.com, x@y.z", CORS_ORIGINS: "https://a.example,https://b.example" });
    expect(c).toMatchObject({ port: 9000, dataDir: "/data", adminEmails: ["jo@example.com", "x@y.z"], corsOrigins: ["https://a.example", "https://b.example"] });
    expect(fromEnv({})).toMatchObject({ port: 8787, corsOrigins: ["*"], adminEmails: [] });
  });
});

describe("accounts", () => {
  let s: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => void (s = await start()));
  afterAll(() => s.app.close());

  it("registers, and stores neither the password nor the token", async () => {
    const r = await s.call("POST", "/api/auth/register", { email: " Anna@Example.com ", password: PASSWORD, displayName: "Anna" });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ email: "anna@example.com", displayName: "Anna", isAdmin: false });
    expect(r.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const user = s.app.db.get<{ password: string }>("SELECT password FROM users WHERE email = ?", "anna@example.com")!;
    expect(user.password).toMatch(/^scrypt\$/);
    expect(user.password).not.toContain(PASSWORD);
    const session = s.app.db.get<{ token_hash: string }>("SELECT token_hash FROM sessions")!;
    expect(session.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.token_hash).not.toBe(r.body.token);
  });

  it("rejects duplicates, weak passwords and bad input", async () => {
    const dupMail = await s.call("POST", "/api/auth/register", { email: "anna@example.com", password: PASSWORD, displayName: "Anna 2" });
    expect([dupMail.status, dupMail.body.error.code]).toEqual([409, "email_taken"]);
    const dupName = await s.call("POST", "/api/auth/register", { email: "anna2@example.com", password: PASSWORD, displayName: "ANNA" });
    expect([dupName.status, dupName.body.error.code]).toEqual([409, "name_taken"]);
    const weak = await s.call("POST", "/api/auth/register", { email: "weak@example.com", password: "short", displayName: "Weak" });
    expect([weak.status, weak.body.error.code]).toEqual([400, "weak_password"]);
    const mail = await s.call("POST", "/api/auth/register", { email: "not-an-email", password: PASSWORD, displayName: "Mail" });
    expect([mail.status, mail.body.error.code]).toEqual([400, "bad_request"]);
  });

  it("logs in, and rejects a wrong password or unknown e-mail the same way", async () => {
    const ok = await s.call("POST", "/api/auth/login", { email: "ANNA@example.com", password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.user.displayName).toBe("Anna");
    const wrong = await s.call("POST", "/api/auth/login", { email: "anna@example.com", password: "wrong password!" });
    const unknown = await s.call("POST", "/api/auth/login", { email: "nobody@example.com", password: PASSWORD });
    expect([wrong.status, wrong.body.error.code]).toEqual([401, "invalid_credentials"]);
    expect(unknown.body).toEqual(wrong.body);
  });

  it("requires a valid, unexpired token", async () => {
    const { token } = (await s.call("POST", "/api/auth/login", { email: "anna@example.com", password: PASSWORD })).body;
    expect((await s.call("GET", "/api/me", undefined, token)).body.user.email).toBe("anna@example.com");
    expect((await s.call("GET", "/api/me")).body.error.code).toBe("unauthorized");
    const invalid = await s.call("GET", "/api/me", undefined, "x".repeat(43));
    expect([invalid.status, invalid.body.error.code]).toEqual([401, "invalid_token"]);
    s.clock.now += 31 * 24 * 60 * 60 * 1000;
    const expired = await s.call("GET", "/api/me", undefined, token);
    expect([expired.status, expired.body.error.code]).toEqual([401, "invalid_token"]);
  });

  it("logs out", async () => {
    const { token } = (await s.call("POST", "/api/auth/login", { email: "anna@example.com", password: PASSWORD })).body;
    expect((await s.call("POST", "/api/auth/logout", undefined, token)).status).toBe(204);
    expect((await s.call("GET", "/api/me", undefined, token)).status).toBe(401);
  });

  it("changes the display name", async () => {
    const bert = await register(s.call, "Bert");
    const taken = await s.call("PATCH", "/api/me", { displayName: "anna" }, bert.token);
    expect([taken.status, taken.body.error.code]).toEqual([409, "name_taken"]);
    const ok = await s.call("PATCH", "/api/me", { displayName: "Bert Holz" }, bert.token);
    expect(ok.body.user.displayName).toBe("Bert Holz");
    expect((await s.call("GET", "/api/me", undefined, bert.token)).body.user.displayName).toBe("Bert Holz");
  });

  it("changes the password and signs other devices out", async () => {
    const c = await register(s.call, "Cara");
    const other = (await s.call("POST", "/api/auth/login", { email: "cara@example.com", password: PASSWORD })).body.token;
    const wrong = await s.call("POST", "/api/me/password", { currentPassword: "not my password", newPassword: "another long one" }, c.token);
    expect([wrong.status, wrong.body.error.code]).toEqual([403, "wrong_password"]);
    const weak = await s.call("POST", "/api/me/password", { currentPassword: PASSWORD, newPassword: "short" }, c.token);
    expect(weak.body.error.code).toBe("weak_password");
    expect((await s.call("POST", "/api/me/password", { currentPassword: PASSWORD, newPassword: "another long one" }, c.token)).status).toBe(204);
    expect((await s.call("GET", "/api/me", undefined, c.token)).status).toBe(200);
    expect((await s.call("GET", "/api/me", undefined, other)).status).toBe(401);
    expect((await s.call("POST", "/api/auth/login", { email: "cara@example.com", password: PASSWORD })).status).toBe(401);
    expect((await s.call("POST", "/api/auth/login", { email: "cara@example.com", password: "another long one" })).status).toBe(200);
  });

  it("sets a password from the admin command", async () => {
    await register(s.call, "Dora");
    expect(await s.app.accounts.setPassword("nobody@example.com", "a new long password")).toBe(false);
    await expect(s.app.accounts.setPassword("dora@example.com", "short")).rejects.toThrow();
    expect(await s.app.accounts.setPassword("Dora@example.com", "a new long password")).toBe(true);
    expect((await s.call("POST", "/api/auth/login", { email: "dora@example.com", password: "a new long password" })).status).toBe(200);
  });

  it("deletes the account with its packs, ratings and documents", async () => {
    const e = await register(s.call, "Emil");
    const f = await register(s.call, "Frida");
    const mine = (await s.call("POST", "/api/packs", pack({ name: "Emil's pack" }), e.token)).body.pack.id;
    const theirs = (await s.call("POST", "/api/packs", pack({ name: "Frida's pack" }), f.token)).body.pack.id;
    await s.call("PUT", `/api/packs/${theirs}/rating`, { stars: 2 }, e.token);
    await s.call("PUT", "/api/sync/docs/shop/default", { baseRevision: 0, doc: { a: 1 } }, e.token);
    const wrong = await s.call("DELETE", "/api/me", { password: "not my password" }, e.token);
    expect([wrong.status, wrong.body.error.code]).toEqual([403, "wrong_password"]);
    expect((await s.call("DELETE", "/api/me", { password: PASSWORD }, e.token)).status).toBe(204);
    expect((await s.call("GET", "/api/me", undefined, e.token)).status).toBe(401);
    expect((await s.call("GET", `/api/packs/${mine}`)).status).toBe(404);
    expect((await s.call("GET", `/api/packs/${theirs}`)).body.pack.rating.count).toBe(0);
    expect(s.app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sync_docs WHERE user_id = ?", e.id)!.n).toBe(0);
    // The e-mail and name are free again.
    await register(s.call, "Emil");
  });
});

describe("rate limit", () => {
  it("limits auth and publishing per address and refills over time", async () => {
    const s = await start({ rateLimits: { auth: { burst: 3, perMinute: 6 }, publish: { burst: 1, perMinute: 1 } } });
    const login = (): Promise<Res> => s.call("POST", "/api/auth/login", { email: "x@example.com", password: "wrong password" });
    for (let i = 0; i < 3; i++) expect((await login()).status).toBe(401);
    const limited = await login();
    expect([limited.status, limited.body.error.code]).toEqual([429, "rate_limited"]);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limited.body.retryAfter).toBe(Number(limited.headers.get("retry-after")));
    s.clock.now += 10_000;
    expect((await login()).status).toBe(401);
    // Other endpoints are not affected.
    expect((await s.call("GET", "/api/packs")).status).toBe(200);

    s.clock.now += 60_000;
    const a = await register(s.call, "Anna");
    expect((await s.call("POST", "/api/packs", pack(), a.token)).status).toBe(201);
    expect((await s.call("POST", "/api/packs", pack({ name: "Second pack" }), a.token)).status).toBe(429);
    await s.app.close();
  });
});

describe("community packs", () => {
  let s: Awaited<ReturnType<typeof start>>;
  let anna: { token: string; id: string };
  let bert: { token: string; id: string };
  let admin: { token: string; id: string };
  let packId = "";
  beforeAll(async () => {
    s = await start({ maxContentBytes: 20_000 });
    anna = await register(s.call, "Anna");
    bert = await register(s.call, "Bert");
    admin = await register(s.call, "Admin", "admin@example.com");
  });
  afterAll(() => s.app.close());

  it("publishes a pack with content checked by the engine schemas", async () => {
    expect((await s.call("POST", "/api/packs", pack())).body.error.code).toBe("unauthorized");
    const r = await s.call("POST", "/api/packs", pack({ content: { ...shop.library, templates: [template("t1")], junk: "dropped" } }), anna.token);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    packId = r.body.pack.id;
    expect(r.body.pack).toMatchObject({
      name: "Dowel 32 construction",
      licence: "CC-BY-4.0",
      language: "en",
      trust: "community",
      latestVersion: "1.0.0",
      tags: ["dowel", "32mm"],
      types: ["presets", "templates", "materials", "drawingStyles"],
      counts: { presets: 1, templates: 1, materials: 1, drawingStyles: 1 },
      author: { displayName: "Anna" },
      isOwner: true,
      downloads: 0,
      rating: { average: null, count: 0 },
    });
    const detail = (await s.call("GET", `/api/packs/${packId}`)).body.pack;
    expect(detail.content.presets[0].id).toBe("dowel-32-sides-over");
    expect(detail.content.templates[0].cabinet.fronts).toHaveLength(2);
    expect(detail.content.junk).toBeUndefined();
    expect(detail.versions).toEqual([{ version: "1.0.0", changelog: "First release", size: expect.any(Number), createdAt: expect.any(Number) }]);
    expect(detail.isOwner).toBe(false);
  });

  it("rejects invalid, empty and oversize content", async () => {
    const invalid = await s.call("POST", "/api/packs", pack({ content: { presets: [{ id: "x", name: "X", vars: { "not valid": 1 } }] } }), anna.token);
    expect([invalid.status, invalid.body.error.code]).toEqual([400, "invalid_content"]);
    expect(invalid.body.details[0].path).toContain("presets.0.vars");
    const hardware = await s.call("POST", "/api/packs", pack({ content: { hardware: [{ id: "h", name: "H" }] } }), anna.token);
    expect(hardware.body.error.code).toBe("invalid_content");
    const empty = await s.call("POST", "/api/packs", pack({ content: {} }), anna.token);
    expect(empty.body.error.code).toBe("invalid_content");
    const dup = await s.call("POST", "/api/packs", pack({ content: { presets: [preset("a"), preset("a")] } }), anna.token);
    expect(dup.body.error.code).toBe("invalid_content");
    const big = await s.call("POST", "/api/packs", pack({ content: { presets: Array.from({ length: 200 }, (_, i) => preset(`p${i}`)) } }), anna.token);
    expect([big.status, big.body.error.code]).toEqual([413, "content_too_large"]);
    const huge = await s.call("POST", "/api/packs", pack({ description: "x".repeat(2000), content: { presets: [{ ...preset("a"), junk: "y".repeat(60_000) }] } }), anna.token);
    expect([huge.status, huge.body.error.code]).toEqual([413, "payload_too_large"]);
    const meta = await s.call("POST", "/api/packs", pack({ licence: "proprietary" }), anna.token);
    expect([meta.status, meta.body.error.code]).toEqual([400, "bad_request"]);
    const version = await s.call("POST", "/api/packs", pack({ version: "one" }), anna.token);
    expect(version.body.error.code).toBe("bad_request");
  });

  it("publishes new versions for the owner only", async () => {
    const body = { version: "1.1.0", changelog: "Added a second preset", content: { presets: [preset("p1"), preset("p2")] } };
    const other = await s.call("POST", `/api/packs/${packId}/versions`, body, bert.token);
    expect([other.status, other.body.error.code]).toEqual([403, "forbidden"]);
    const old = await s.call("POST", `/api/packs/${packId}/versions`, { ...body, version: "1.0.0" }, anna.token);
    expect([old.status, old.body.error.code]).toEqual([409, "version_not_newer"]);
    expect(old.body.latestVersion).toBe("1.0.0");
    const bad = await s.call("POST", `/api/packs/${packId}/versions`, { ...body, content: { presets: [{ id: "" }] } }, anna.token);
    expect(bad.body.error.code).toBe("invalid_content");
    s.clock.now += 1000;
    const ok = await s.call("POST", `/api/packs/${packId}/versions`, body, anna.token);
    expect(ok.status).toBe(201);
    expect(ok.body.pack).toMatchObject({ latestVersion: "1.1.0", types: ["presets"], counts: { presets: 2 } });
    const detail = (await s.call("GET", `/api/packs/${packId}`)).body.pack;
    expect(detail.versions.map((v: any) => v.version)).toEqual(["1.1.0", "1.0.0"]);
    expect(detail.content.presets).toHaveLength(2);
    const first = await s.call("GET", `/api/packs/${packId}/versions/1.0.0`);
    expect(first.body.content.templates).toHaveLength(1);
    expect((await s.call("GET", `/api/packs/${packId}/versions/9.9.9`)).status).toBe(404);
  });

  it("orders versions", () => {
    expect(compareVersions("1.10", "1.9.5")).toBeGreaterThan(0);
    expect(compareVersions("2", "2.0.0")).toBe(0);
    expect(compareVersions("2.0.0-beta", "2.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.1", "1.0.0")).toBeGreaterThan(0);
  });

  it("edits metadata for the owner only", async () => {
    const other = await s.call("PATCH", `/api/packs/${packId}`, { name: "Hijacked" }, bert.token);
    expect([other.status, other.body.error.code]).toEqual([403, "forbidden"]);
    const unknown = await s.call("PATCH", `/api/packs/${packId}`, { verified: true }, anna.token);
    expect(unknown.body.error.code).toBe("bad_request");
    const ok = await s.call("PATCH", `/api/packs/${packId}`, { description: "Now with groove.", tags: ["Dübel", "dowel"], licence: "CC0-1.0", language: "de", tested: true }, anna.token);
    expect(ok.body.pack).toMatchObject({ name: "Dowel 32 construction", description: "Now with groove.", tags: ["dübel", "dowel"], licence: "CC0-1.0", language: "de", trust: "tested" });
  });

  it("rates once per user, not the own pack", async () => {
    const own = await s.call("PUT", `/api/packs/${packId}/rating`, { stars: 5 }, anna.token);
    expect([own.status, own.body.error.code]).toEqual([403, "own_pack"]);
    expect((await s.call("PUT", `/api/packs/${packId}/rating`, { stars: 5 })).status).toBe(401);
    expect((await s.call("PUT", `/api/packs/${packId}/rating`, { stars: 6 }, bert.token)).body.error.code).toBe("bad_request");
    expect((await s.call("PUT", `/api/packs/${packId}/rating`, { stars: 5 }, bert.token)).body).toEqual({ rating: { average: 5, count: 1 }, myRating: 5 });
    expect((await s.call("PUT", `/api/packs/${packId}/rating`, { stars: 2 }, bert.token)).body.rating).toEqual({ average: 2, count: 1 });
    expect((await s.call("PUT", `/api/packs/${packId}/rating`, { stars: 5 }, admin.token)).body.rating).toEqual({ average: 3.5, count: 2 });
    expect((await s.call("GET", `/api/packs/${packId}`, undefined, bert.token)).body.pack.myRating).toBe(2);
    expect((await s.call("DELETE", `/api/packs/${packId}/rating`, undefined, admin.token)).body.rating).toEqual({ average: 2, count: 1 });
  });

  it("counts installs once per account or per address and day", async () => {
    const ping = (token?: string): Promise<Res> => s.call("POST", `/api/packs/${packId}/installed`, { version: "1.1.0" }, token);
    expect((await ping(bert.token)).body).toEqual({ counted: true, downloads: 1 });
    expect((await ping(bert.token)).body).toEqual({ counted: false, downloads: 1 });
    expect((await ping()).body.downloads).toBe(2);
    expect((await ping()).body).toEqual({ counted: false, downloads: 2 });
    s.clock.now += 24 * 60 * 60 * 1000;
    expect((await ping()).body.downloads).toBe(3);
    expect((await s.call("POST", "/api/packs/nope/installed")).status).toBe(404);
  });

  it("lists with search, filters, sorting and pages", async () => {
    s.clock.now += 1000;
    const hinge = (await s.call("POST", "/api/packs", pack({ name: "Sensys hinge set", description: "Cup and plate patterns", tags: ["hettich"], tested: true, content: { materials: shop.library.materials } }), bert.token)).body.pack.id;
    s.clock.now += 1000;
    const fork = await s.call("POST", "/api/packs", pack({ name: "Dowel 32 fork", tags: [], forkedFrom: packId }), bert.token);
    expect(fork.body.pack.forkedFrom).toEqual({ id: packId, name: "Dowel 32 construction" });
    expect((await s.call("POST", "/api/packs", pack({ forkedFrom: "nope" }), bert.token)).status).toBe(400);
    await s.call("PUT", `/api/packs/${hinge}/rating`, { stars: 4 }, anna.token);

    const names = async (q: string): Promise<string[]> => (await s.call("GET", `/api/packs?${q}`)).body.items.map((p: any) => p.name);
    expect(await names("")).toEqual(["Dowel 32 fork", "Sensys hinge set", "Dowel 32 construction"]);
    expect(await names("sort=downloads")).toEqual(["Dowel 32 construction", "Dowel 32 fork", "Sensys hinge set"]);
    expect(await names("sort=rating")).toEqual(["Sensys hinge set", "Dowel 32 construction", "Dowel 32 fork"]);
    expect(await names("q=HINGE")).toEqual(["Sensys hinge set"]);
    expect(await names("q=anna")).toEqual(["Dowel 32 construction"]);
    expect(await names("q=100%25")).toEqual([]);
    expect(await names("type=materials")).toEqual(["Sensys hinge set"]);
    expect(await names("type=templates")).toEqual(["Dowel 32 fork"]);
    expect(await names(`tag=${encodeURIComponent("dübel")}`)).toEqual(["Dowel 32 construction"]);
    expect(await names("trust=tested")).toEqual(["Sensys hinge set", "Dowel 32 construction"]);
    expect(await names("trust=community,verified")).toEqual(["Dowel 32 fork"]);
    expect(await names(`ids=${hinge},nope`)).toEqual(["Sensys hinge set"]);
    const page = await s.call("GET", "/api/packs?pageSize=2&page=2");
    expect(page.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page.body.items).toHaveLength(1);
    expect((await s.call("GET", "/api/packs?sort=nope")).status).toBe(400);
    expect((await s.call("GET", "/api/packs?mine=1")).status).toBe(401);
    expect((await s.call("GET", "/api/packs?mine=1", undefined, bert.token)).body.items.map((p: any) => p.name)).toEqual(["Dowel 32 fork", "Sensys hinge set"]);
  });

  it("takes reports and lets admins review, hide and verify", async () => {
    expect((await s.call("POST", `/api/packs/${packId}/reports`, { reason: "no" }, bert.token)).body.error.code).toBe("bad_request");
    expect((await s.call("POST", `/api/packs/${packId}/reports`, { reason: "Hinge cup depth is wrong" })).status).toBe(401);
    expect((await s.call("POST", `/api/packs/${packId}/reports`, { reason: "Hinge cup depth is wrong" }, bert.token)).status).toBe(201);
    expect((await s.call("GET", `/api/packs/${packId}`)).body.pack.openReports).toBe(1);

    const denied = await s.call("GET", "/api/admin/reports", undefined, bert.token);
    expect([denied.status, denied.body.error.code]).toEqual([403, "forbidden"]);
    expect((await s.call("PATCH", `/api/admin/packs/${packId}`, { verified: true }, anna.token)).status).toBe(403);
    expect((await s.call("GET", "/api/me", undefined, admin.token)).body.user.isAdmin).toBe(true);

    const reports = (await s.call("GET", "/api/admin/reports", undefined, admin.token)).body.items;
    expect(reports).toEqual([expect.objectContaining({ reason: "Hinge cup depth is wrong", reporter: "Bert", pack: { id: packId, name: "Dowel 32 construction", hidden: false } })]);

    const verified = await s.call("PATCH", `/api/admin/packs/${packId}`, { verified: true }, admin.token);
    expect(verified.body.pack.trust).toBe("verified");
    // A new version has not been reviewed.
    await s.call("POST", `/api/packs/${packId}/versions`, { version: "1.2", content: { presets: [preset("p1")] }, tested: true }, anna.token);
    expect((await s.call("GET", `/api/packs/${packId}`)).body.pack.trust).toBe("tested");

    const hidden = await s.call("PATCH", `/api/admin/packs/${packId}`, { hidden: true }, admin.token);
    expect(hidden.body.pack.hidden).toBe(true);
    expect((await s.call("GET", `/api/packs/${packId}`, undefined, bert.token)).status).toBe(404);
    expect((await s.call("GET", `/api/packs/${packId}`, undefined, anna.token)).body.pack.hidden).toBe(true);
    expect((await s.call("GET", "/api/packs?q=construction")).body.total).toBe(0);
    expect((await s.call("GET", "/api/packs?q=construction&hidden=1", undefined, admin.token)).body.total).toBe(1);
    expect((await s.call("GET", "/api/packs?q=construction&hidden=1", undefined, bert.token)).body.total).toBe(0);
    await s.call("PATCH", `/api/admin/packs/${packId}`, { hidden: false }, admin.token);
    expect((await s.call("GET", `/api/packs/${packId}`, undefined, bert.token)).status).toBe(200);

    expect((await s.call("POST", `/api/admin/reports/${reports[0].id}/resolve`, undefined, admin.token)).status).toBe(204);
    expect((await s.call("POST", `/api/admin/reports/${reports[0].id}/resolve`, undefined, admin.token)).status).toBe(404);
    expect((await s.call("GET", "/api/admin/reports", undefined, admin.token)).body.items).toEqual([]);
    expect((await s.call("GET", "/api/admin/reports?all=1", undefined, admin.token)).body.items).toHaveLength(1);
  });

  it("unpublishes for the owner only", async () => {
    const other = await s.call("DELETE", `/api/packs/${packId}`, undefined, bert.token);
    expect([other.status, other.body.error.code]).toEqual([403, "forbidden"]);
    expect((await s.call("DELETE", `/api/packs/${packId}`, undefined, anna.token)).status).toBe(204);
    expect((await s.call("GET", `/api/packs/${packId}`)).status).toBe(404);
    expect((await s.call("GET", "/api/packs?q=fork")).body.items[0].forkedFrom).toEqual({ id: packId, name: null });
  });
});

describe("sync", () => {
  let s: Awaited<ReturnType<typeof start>>;
  let anna: { token: string; id: string };
  let bert: { token: string; id: string };
  beforeAll(async () => {
    s = await start({ maxSyncBytes: 5000 });
    anna = await register(s.call, "Anna");
    bert = await register(s.call, "Bert");
  });
  afterAll(() => s.app.close());

  it("stores a document per user with a revision counter", async () => {
    expect((await s.call("GET", "/api/sync/docs/shop/default")).status).toBe(401);
    expect((await s.call("GET", "/api/sync/docs/shop/default", undefined, anna.token)).status).toBe(404);
    const first = await s.call("PUT", "/api/sync/docs/shop/default", { baseRevision: 0, doc: shop }, anna.token);
    expect(first.body).toMatchObject({ kind: "shop", id: "default", revision: 1 });
    const got = await s.call("GET", "/api/sync/docs/shop/default", undefined, anna.token);
    expect(got.body).toMatchObject({ revision: 1, doc: shop, updatedAt: s.clock.now });
    const second = await s.call("PUT", "/api/sync/docs/shop/default", { baseRevision: 1, doc: { ...shop, name: "Device A" } }, anna.token);
    expect(second.body.revision).toBe(2);
    expect((await s.call("GET", "/api/sync/docs/shop", undefined, anna.token)).body.items).toEqual([{ kind: "shop", id: "default", revision: 2, updatedAt: s.clock.now }]);
    // Other accounts never see it.
    expect((await s.call("GET", "/api/sync/docs/shop/default", undefined, bert.token)).status).toBe(404);
  });

  it("answers a stale write with 409 and the server copy", async () => {
    const stale = await s.call("PUT", "/api/sync/docs/shop/default", { baseRevision: 1, doc: { ...shop, name: "Device B" } }, anna.token);
    expect([stale.status, stale.body.error.code]).toEqual([409, "conflict"]);
    expect(stale.body.current).toMatchObject({ revision: 2, doc: { name: "Device A" } });
    const create = await s.call("PUT", "/api/sync/docs/shop/default", { baseRevision: 0, doc: shop }, anna.token);
    expect(create.status).toBe(409);
    const missing = await s.call("PUT", "/api/sync/docs/project/kitchen-1", { baseRevision: 3, doc: {} }, anna.token);
    expect([missing.status, missing.body.current]).toEqual([409, null]);
    const retry = await s.call("PUT", "/api/sync/docs/shop/default", { baseRevision: 2, doc: { ...shop, name: "Device B" } }, anna.token);
    expect(retry.body.revision).toBe(3);
  });

  it("validates names and size, and deletes", async () => {
    expect((await s.call("PUT", "/api/sync/docs/Shop/x", { baseRevision: 0, doc: {} }, anna.token)).status).toBe(400);
    expect((await s.call("PUT", "/api/sync/docs/shop/default", { baseRevision: 3, doc: "text" }, anna.token)).body.error.code).toBe("bad_request");
    const big = await s.call("PUT", "/api/sync/docs/shop/default", { baseRevision: 3, doc: { x: "y".repeat(6000) } }, anna.token);
    expect([big.status, big.body.error.code]).toEqual([413, "payload_too_large"]);
    expect((await s.call("DELETE", "/api/sync/docs/shop/default", undefined, bert.token)).status).toBe(404);
    expect((await s.call("DELETE", "/api/sync/docs/shop/default", undefined, anna.token)).status).toBe(204);
    expect((await s.call("GET", "/api/sync/docs/shop/default", undefined, anna.token)).status).toBe(404);
  });
});

describe("database file", () => {
  it("keeps data across restarts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cp-server-"));
    try {
      const a = await start({ dataDir: dir });
      const { token } = await register(a.call, "Anna");
      await a.app.close();
      const b = await start({ dataDir: dir });
      expect(b.app.db.version).toBe(MIGRATIONS.length);
      expect((await b.call("GET", "/api/me", undefined, token)).body.user.displayName).toBe("Anna");
      await b.app.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
