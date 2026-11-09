/**
 * Typed client for the optional Cabinet Planner server (accounts,
 * community packs, sync). Plain fetch, no state: `account.svelte.ts` holds
 * the session. Every failure is a `CloudError` with a stable `code` the UI
 * translates (`cloud.error.<code>`); server messages are never shown.
 */

export type Doc = Record<string, any>;
export type Trust = "community" | "tested" | "verified";
export type PackSort = "newest" | "downloads" | "rating";

export const LICENCES = ["CC-BY-4.0", "CC-BY-SA-4.0", "CC0-1.0", "MIT"] as const;

export interface CloudUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: number;
  isAdmin: boolean;
}

export interface Session {
  token: string;
  expiresAt: number;
  user: CloudUser;
}

export interface PackSummary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  /** Library kinds the latest version contains. */
  types: string[];
  counts: Record<string, number>;
  licence: string;
  language: string;
  trust: Trust;
  author: { id: string; displayName: string };
  latestVersion: string;
  downloads: number;
  rating: { average: number | null; count: number };
  forkedFrom: { id: string; name: string | null } | null;
  createdAt: number;
  updatedAt: number;
  isOwner: boolean;
  hidden?: boolean;
}

export interface PackVersion {
  version: string;
  changelog: string;
  size: number;
  createdAt: number;
}

export interface PackDetail extends PackSummary {
  versions: PackVersion[];
  /** Library fragment of the latest version. */
  content: Doc;
  myRating: number | null;
  openReports: number;
}

export interface PackList {
  items: PackSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PackQuery {
  q?: string;
  type?: string;
  tag?: string;
  trust?: Trust[];
  sort?: PackSort;
  page?: number;
  pageSize?: number;
  mine?: boolean;
  ids?: string[];
}

export interface PackMeta {
  name: string;
  description: string;
  tags: string[];
  licence: string;
  language: string;
  tested: boolean;
}

export interface SyncDoc {
  kind: string;
  id: string;
  revision: number;
  updatedAt: number;
  doc: Doc;
}

/**
 * Codes made here: `no_server` (no URL set), `unreachable` (no answer:
 * offline, wrong address, blocked), `timeout`, `bad_response` (not our
 * server). All others come from the server.
 */
export class CloudError extends Error {
  constructor(
    readonly code: string,
    readonly status = 0,
    /** Extra fields of the error response (e.g. `current` on a sync conflict). */
    readonly data: Doc = {},
  ) {
    super(code);
  }
}

export const isCloudError = (e: unknown, code?: string): e is CloudError => e instanceof CloudError && (!code || e.code === code);
/** Failures that say nothing about the request: the server could not be asked. */
export const isConnectionError = (e: unknown): boolean => e instanceof CloudError && ["unreachable", "timeout", "no_server", "bad_response"].includes(e.code);

/** "192.168.1.5:8787/" → "http://192.168.1.5:8787"; empty when it is not a usable address. */
export function normalizeServerUrl(input: string): string {
  let s = input.trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = `${/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(s) ? "http" : "https"}://${s}`;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

const TIMEOUT_MS = 15_000;

export class CloudClient {
  constructor(
    readonly baseUrl: string,
    private token: () => string | null = () => null,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    if (!this.baseUrl) throw new CloudError("no_server");
    const token = auth ? this.token() : null;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: abort.signal,
        cache: "no-store",
      });
    } catch {
      throw new CloudError(abort.signal.aborted ? "timeout" : "unreachable");
    } finally {
      clearTimeout(timer);
    }
    let data: Doc | undefined;
    try {
      const text = await res.text();
      data = text ? (JSON.parse(text) as Doc) : undefined;
    } catch {
      throw new CloudError("bad_response", res.status);
    }
    if (!res.ok) {
      const code = data?.error?.code;
      if (typeof code !== "string") throw new CloudError("bad_response", res.status);
      const { error: _e, ...rest } = data!;
      throw new CloudError(code, res.status, rest);
    }
    return data as T;
  }

  /** Checks that the address is a Cabinet Planner server. */
  async health(): Promise<{ ok: boolean; version: string; api: number; licences: string[]; maxContentBytes: number }> {
    const h = await this.request<Doc>("GET", "/health", undefined, false);
    if (h?.name !== "cabinet-planner-server") throw new CloudError("bad_response");
    return h as never;
  }

  // --- Account ---------------------------------------------------------------
  register(email: string, password: string, displayName: string): Promise<Session> {
    return this.request("POST", "/api/auth/register", { email, password, displayName }, false);
  }
  login(email: string, password: string): Promise<Session> {
    return this.request("POST", "/api/auth/login", { email, password }, false);
  }
  async logout(): Promise<void> {
    await this.request("POST", "/api/auth/logout");
  }
  async me(): Promise<CloudUser> {
    return (await this.request<{ user: CloudUser }>("GET", "/api/me")).user;
  }
  async setDisplayName(displayName: string): Promise<CloudUser> {
    return (await this.request<{ user: CloudUser }>("PATCH", "/api/me", { displayName })).user;
  }
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.request("POST", "/api/me/password", { currentPassword, newPassword });
  }
  async deleteAccount(password: string): Promise<void> {
    await this.request("DELETE", "/api/me", { password });
  }

  // --- Packs -----------------------------------------------------------------
  packs(q: PackQuery = {}): Promise<PackList> {
    const p = new URLSearchParams();
    if (q.q) p.set("q", q.q);
    if (q.type) p.set("type", q.type);
    if (q.tag) p.set("tag", q.tag);
    if (q.trust?.length) p.set("trust", q.trust.join(","));
    if (q.sort) p.set("sort", q.sort);
    if (q.page) p.set("page", String(q.page));
    if (q.pageSize) p.set("pageSize", String(q.pageSize));
    if (q.mine) p.set("mine", "1");
    if (q.ids) p.set("ids", q.ids.join(","));
    const qs = p.toString();
    return this.request("GET", `/api/packs${qs ? `?${qs}` : ""}`);
  }
  async pack(id: string): Promise<PackDetail> {
    return (await this.request<{ pack: PackDetail }>("GET", `/api/packs/${encodeURIComponent(id)}`)).pack;
  }
  async publish(meta: PackMeta, version: string, changelog: string, content: Doc, forkedFrom?: string): Promise<PackSummary> {
    return (await this.request<{ pack: PackSummary }>("POST", "/api/packs", { ...meta, version, changelog, content, ...(forkedFrom ? { forkedFrom } : {}) })).pack;
  }
  async publishVersion(id: string, version: string, changelog: string, tested: boolean, content: Doc): Promise<PackSummary> {
    return (await this.request<{ pack: PackSummary }>("POST", `/api/packs/${encodeURIComponent(id)}/versions`, { version, changelog, tested, content })).pack;
  }
  async editPack(id: string, meta: Partial<PackMeta>): Promise<PackSummary> {
    return (await this.request<{ pack: PackSummary }>("PATCH", `/api/packs/${encodeURIComponent(id)}`, meta)).pack;
  }
  async unpublish(id: string): Promise<void> {
    await this.request("DELETE", `/api/packs/${encodeURIComponent(id)}`);
  }
  rate(id: string, stars: number): Promise<{ rating: PackSummary["rating"]; myRating: number | null }> {
    return this.request("PUT", `/api/packs/${encodeURIComponent(id)}/rating`, { stars });
  }
  async report(id: string, reason: string): Promise<void> {
    await this.request("POST", `/api/packs/${encodeURIComponent(id)}/reports`, { reason });
  }
  installed(id: string, version: string): Promise<{ counted: boolean; downloads: number }> {
    return this.request("POST", `/api/packs/${encodeURIComponent(id)}/installed`, { version });
  }
  async adminSetPack(id: string, change: { hidden?: boolean; verified?: boolean }): Promise<PackSummary> {
    return (await this.request<{ pack: PackSummary }>("PATCH", `/api/admin/packs/${encodeURIComponent(id)}`, change)).pack;
  }

  // --- Sync ------------------------------------------------------------------
  /** The synced document, or null when the server has none. */
  async getDoc(kind: string, id: string): Promise<SyncDoc | null> {
    try {
      return await this.request<SyncDoc>("GET", `/api/sync/docs/${kind}/${id}`);
    } catch (e) {
      if (isCloudError(e, "not_found")) return null;
      throw e;
    }
  }
  /** Writes a document based on `baseRevision`; a `conflict` error carries `data.current` (the server copy or null). */
  putDoc(kind: string, id: string, baseRevision: number, doc: Doc): Promise<{ revision: number; updatedAt: number }> {
    return this.request("PUT", `/api/sync/docs/${kind}/${id}`, { baseRevision, doc });
  }
}
