import { createHash } from "node:crypto";
import { LIBRARY_KINDS, LibraryFragmentSchema, type LibraryFragment, type LibraryKind } from "@cabinet-planner/engine";
import { z } from "zod";
import { newId } from "./auth.ts";
import type { ServerConfig } from "./config.ts";
import type { Db } from "./db.ts";
import { ApiError, forbidden, notFound, parse, type AuthedCtx, type Route, type User } from "./http.ts";

/** Licences a pack can carry; the first is the default. */
export const LICENCES = ["CC-BY-4.0", "CC-BY-SA-4.0", "CC0-1.0", "MIT"] as const;
export const TRUST_LEVELS = ["community", "tested", "verified"] as const;
export type Trust = (typeof TRUST_LEVELS)[number];

// --- Versions ---------------------------------------------------------------

const VERSION_RE = /^(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?(?:-([0-9A-Za-z.]{1,20}))?$/;

/** Compares "1.2", "1.2.1", "2.0.0-beta": negative when a < b. A pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const pa = VERSION_RE.exec(a);
  const pb = VERSION_RE.exec(b);
  if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i] ?? 0) - Number(pb[i] ?? 0);
    if (d) return d;
  }
  if (pa[4] === pb[4]) return 0;
  if (pa[4] === undefined) return 1;
  if (pb[4] === undefined) return -1;
  return pa[4] < pb[4] ? -1 : 1;
}

// --- Request bodies ---------------------------------------------------------

const Tag = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}-]{0,23}$/u, "letters, digits and '-' only, up to 24 characters");
const meta = {
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(2000).default(""),
  tags: z
    .array(Tag)
    .max(8)
    .default([])
    .transform((t) => [...new Set(t)]),
  licence: z.enum(LICENCES).default("CC-BY-4.0"),
  language: z
    .string()
    .regex(/^[a-z]{2}$/)
    .default("en"),
  /** The author machined a part with this data. */
  tested: z.boolean().default(false),
};
const Version = z.string().regex(VERSION_RE, "use a version like 1.0 or 1.2.3");
const Changelog = z.string().trim().max(2000).default("");

const PublishBody = z.object({
  ...meta,
  version: Version.default("1.0.0"),
  changelog: Changelog,
  forkedFrom: z.string().max(40).optional(),
  content: z.unknown(),
});
const VersionBody = z.object({ version: Version, changelog: Changelog, tested: z.boolean().default(false), content: z.unknown() });
const MetaBody = z
  .object({
    name: meta.name.optional(),
    description: z.string().trim().max(2000).optional(),
    tags: z
      .array(Tag)
      .max(8)
      .transform((t) => [...new Set(t)])
      .optional(),
    licence: z.enum(LICENCES).optional(),
    language: z
      .string()
      .regex(/^[a-z]{2}$/)
      .optional(),
    tested: z.boolean().optional(),
  })
  .strict();
const RatingBody = z.object({ stars: z.number().int().min(1).max(5) });
const ReportBody = z.object({ reason: z.string().trim().min(5).max(2000) });
const AdminPackBody = z.object({ hidden: z.boolean().optional(), verified: z.boolean().optional() }).strict();

const ListQuery = z.object({
  q: z.string().trim().max(100).default(""),
  type: z.enum(LIBRARY_KINDS).optional(),
  tag: Tag.optional(),
  trust: z.string().max(40).optional(),
  sort: z.enum(["newest", "downloads", "rating"]).default("newest"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  mine: z.enum(["0", "1"]).default("0"),
  hidden: z.enum(["0", "1"]).default("0"),
  ids: z.string().max(2000).optional(),
});

// --- Content ----------------------------------------------------------------

interface Checked {
  json: string;
  size: number;
  types: LibraryKind[];
  counts: Record<string, number>;
}

/** Validates pack content with the engine's library schema and the size limit. */
function checkContent(raw: unknown, maxBytes: number): Checked {
  // Unknown keys are dropped: the stored content is exactly what the engine reads.
  const content: LibraryFragment = parse(LibraryFragmentSchema, raw, "invalid_content");
  const counts: Record<string, number> = {};
  for (const kind of LIBRARY_KINDS) {
    const items = content[kind] as { id: string }[];
    const ids = new Set(items.map((x) => x.id));
    if (ids.size !== items.length) throw new ApiError(400, "invalid_content", `Duplicate id in ${kind}`);
    if (items.length) counts[kind] = items.length;
  }
  const types = LIBRARY_KINDS.filter((k) => counts[k]);
  if (!types.length) throw new ApiError(400, "invalid_content", "A pack needs at least one item");
  const json = JSON.stringify(content);
  const size = Buffer.byteLength(json, "utf8");
  if (size > maxBytes) throw new ApiError(413, "content_too_large", `Pack content is larger than ${maxBytes} bytes`);
  return { json, size, types, counts };
}

const packList = (items: string[]): string => (items.length ? `,${items.join(",")},` : ",");
const unpackList = (s: string): string[] => s.split(",").filter(Boolean);
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// --- Rows -------------------------------------------------------------------

interface PackRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  tags: string;
  types: string;
  counts: string;
  licence: string;
  language: string;
  tested: number;
  verified: number;
  hidden: number;
  forked_from: string | null;
  latest_version: string;
  downloads: number;
  created_at: number;
  updated_at: number;
  author: string;
  rating_count: number | null;
  rating_avg: number | null;
  fork_name: string | null;
}

const SELECT = `
  SELECT p.*, u.display_name AS author, r.c AS rating_count, r.a AS rating_avg, f.name AS fork_name
  FROM packs p
  JOIN users u ON u.id = p.owner_id
  LEFT JOIN (SELECT pack_id, COUNT(*) AS c, AVG(stars) AS a FROM ratings GROUP BY pack_id) r ON r.pack_id = p.id
  LEFT JOIN packs f ON f.id = p.forked_from AND f.hidden = 0`;

const trustOf = (row: { tested: number; verified: number }): Trust => (row.verified ? "verified" : row.tested ? "tested" : "community");

function summary(row: PackRow, viewer: User | null): Record<string, unknown> {
  const own = viewer?.id === row.owner_id;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tags: unpackList(row.tags),
    types: unpackList(row.types),
    counts: JSON.parse(row.counts) as Record<string, number>,
    licence: row.licence,
    language: row.language,
    trust: trustOf(row),
    author: { id: row.owner_id, displayName: row.author },
    latestVersion: row.latest_version,
    downloads: row.downloads,
    rating: { average: row.rating_avg === null ? null : Math.round(row.rating_avg * 100) / 100, count: row.rating_count ?? 0 },
    forkedFrom: row.forked_from ? { id: row.forked_from, name: row.fork_name } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isOwner: own,
    ...(own || viewer?.isAdmin ? { hidden: !!row.hidden } : {}),
  };
}

export function packRoutes(db: Db, config: ServerConfig): Route[] {
  const maxBody = config.maxContentBytes * 2 + 16 * 1024;

  /** A pack the viewer may see: hidden packs only for their owner and admins. */
  const visible = (id: string, viewer: User | null): PackRow => {
    const row = db.get<PackRow>(`${SELECT} WHERE p.id = ?`, id);
    if (!row || (row.hidden && viewer?.id !== row.owner_id && !viewer?.isAdmin)) throw notFound("Pack not found");
    return row;
  };
  const owned = (id: string, user: User): PackRow => {
    const row = visible(id, user);
    if (row.owner_id !== user.id) throw forbidden("Only the author can change this pack");
    return row;
  };

  return [
    {
      method: "GET",
      path: "/api/packs",
      auth: "optional",
      handler({ query, user }) {
        const q = parse(ListQuery, Object.fromEntries(query));
        const where: string[] = [];
        const params: (string | number)[] = [];
        if (q.mine === "1") {
          if (!user) throw new ApiError(401, "unauthorized", "Sign in to list your packs");
          where.push("p.owner_id = ?");
          params.push(user.id);
        } else if (!(q.hidden === "1" && user?.isAdmin)) {
          where.push("p.hidden = 0");
        }
        if (q.q) {
          const like = `%${likeEscape(q.q.toLowerCase())}%`;
          where.push("(LOWER(p.name) LIKE ? ESCAPE '\\' OR LOWER(p.description) LIKE ? ESCAPE '\\' OR LOWER(u.display_name) LIKE ? ESCAPE '\\' OR p.tags LIKE ? ESCAPE '\\')");
          params.push(like, like, like, like);
        }
        if (q.type) {
          where.push("p.types LIKE ?");
          params.push(`%,${q.type},%`);
        }
        if (q.tag) {
          where.push("p.tags LIKE ? ESCAPE '\\'");
          params.push(`%,${likeEscape(q.tag)},%`);
        }
        if (q.trust) {
          const levels = q.trust.split(",").filter((x): x is Trust => (TRUST_LEVELS as readonly string[]).includes(x));
          const conds = levels.map((l) => (l === "verified" ? "p.verified = 1" : l === "tested" ? "(p.verified = 0 AND p.tested = 1)" : "(p.verified = 0 AND p.tested = 0)"));
          where.push(conds.length ? `(${conds.join(" OR ")})` : "0");
        }
        if (q.ids !== undefined) {
          const ids = q.ids.split(",").filter(Boolean).slice(0, 50);
          where.push(ids.length ? `p.id IN (${ids.map(() => "?").join(",")})` : "0");
          params.push(...ids);
        }
        const cond = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const order =
          q.sort === "downloads"
            ? "p.downloads DESC, p.updated_at DESC"
            : q.sort === "rating"
              ? "COALESCE(r.a, 0) DESC, COALESCE(r.c, 0) DESC, p.updated_at DESC"
              : "p.updated_at DESC";
        const total = Number(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM packs p JOIN users u ON u.id = p.owner_id ${cond}`, ...params)?.n ?? 0);
        const rows = db.all<PackRow>(`${SELECT} ${cond} ORDER BY ${order}, p.id LIMIT ? OFFSET ?`, ...params, q.pageSize, (q.page - 1) * q.pageSize);
        return { body: { items: rows.map((r) => summary(r, user)), total, page: q.page, pageSize: q.pageSize } };
      },
    },
    {
      method: "GET",
      path: "/api/packs/:id",
      auth: "optional",
      handler({ params, user }) {
        const row = visible(params.id!, user);
        const versions = db.all<{ version: string; changelog: string; size: number; created_at: number }>(
          "SELECT version, changelog, size, created_at FROM pack_versions WHERE pack_id = ? ORDER BY created_at DESC, rowid DESC",
          row.id,
        );
        const latest = db.get<{ content: string }>("SELECT content FROM pack_versions WHERE pack_id = ? AND version = ?", row.id, row.latest_version);
        const mine = user ? db.get<{ stars: number }>("SELECT stars FROM ratings WHERE pack_id = ? AND user_id = ?", row.id, user.id) : undefined;
        return {
          body: {
            pack: {
              ...summary(row, user),
              versions: versions.map((v) => ({ version: v.version, changelog: v.changelog, size: v.size, createdAt: v.created_at })),
              content: JSON.parse(latest?.content ?? "{}"),
              myRating: mine?.stars ?? null,
              openReports: Number(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM reports WHERE pack_id = ? AND resolved_at IS NULL", row.id)?.n ?? 0),
            },
          },
        };
      },
    },
    {
      method: "GET",
      path: "/api/packs/:id/versions/:version",
      auth: "optional",
      handler({ params, user }) {
        const row = visible(params.id!, user);
        const v = db.get<{ version: string; changelog: string; content: string; size: number; created_at: number }>(
          "SELECT * FROM pack_versions WHERE pack_id = ? AND version = ?",
          row.id,
          params.version!,
        );
        if (!v) throw notFound("Version not found");
        return { body: { version: v.version, changelog: v.changelog, size: v.size, createdAt: v.created_at, content: JSON.parse(v.content) } };
      },
    },
    {
      method: "POST",
      path: "/api/packs",
      auth: "user",
      limit: "publish",
      maxBody,
      handler(ctx) {
        const { user } = ctx as AuthedCtx;
        const b = parse(PublishBody, ctx.body);
        const c = checkContent(b.content, config.maxContentBytes);
        if (b.forkedFrom && !db.get("SELECT id FROM packs WHERE id = ? AND hidden = 0", b.forkedFrom)) throw new ApiError(400, "bad_request", "forkedFrom: unknown pack");
        const id = newId();
        const now = config.now();
        db.tx(() => {
          db.run(
            `INSERT INTO packs (id, owner_id, name, description, tags, types, counts, licence, language, tested, forked_from, latest_version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            id, user.id, b.name, b.description, packList(b.tags), packList(c.types), JSON.stringify(c.counts), b.licence, b.language,
            b.tested ? 1 : 0, b.forkedFrom ?? null, b.version, now, now,
          );
          db.run("INSERT INTO pack_versions (pack_id, version, changelog, content, size, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, b.version, b.changelog, c.json, c.size, now);
        });
        return { status: 201, body: { pack: summary(visible(id, user), user) } };
      },
    },
    {
      method: "POST",
      path: "/api/packs/:id/versions",
      auth: "user",
      limit: "publish",
      maxBody,
      handler(ctx) {
        const { user, params } = ctx as AuthedCtx;
        const row = owned(params.id!, user);
        const b = parse(VersionBody, ctx.body);
        if (compareVersions(b.version, row.latest_version) <= 0) {
          throw new ApiError(409, "version_not_newer", `Version must be newer than ${row.latest_version}`, { latestVersion: row.latest_version });
        }
        const c = checkContent(b.content, config.maxContentBytes);
        const now = config.now();
        db.tx(() => {
          db.run("INSERT INTO pack_versions (pack_id, version, changelog, content, size, created_at) VALUES (?, ?, ?, ?, ?, ?)", row.id, b.version, b.changelog, c.json, c.size, now);
          // New content has not been reviewed: "verified" ends with the version it was given for.
          db.run(
            "UPDATE packs SET latest_version = ?, types = ?, counts = ?, tested = ?, verified = 0, updated_at = ? WHERE id = ?",
            b.version, packList(c.types), JSON.stringify(c.counts), b.tested ? 1 : 0, now, row.id,
          );
        });
        return { status: 201, body: { pack: summary(visible(row.id, user), user) } };
      },
    },
    {
      method: "PATCH",
      path: "/api/packs/:id",
      auth: "user",
      handler(ctx) {
        const { user, params } = ctx as AuthedCtx;
        const row = owned(params.id!, user);
        const b = parse(MetaBody, ctx.body);
        db.run(
          "UPDATE packs SET name = ?, description = ?, tags = ?, licence = ?, language = ?, tested = ? WHERE id = ?",
          b.name ?? row.name,
          b.description ?? row.description,
          b.tags ? packList(b.tags) : row.tags,
          b.licence ?? row.licence,
          b.language ?? row.language,
          b.tested === undefined ? row.tested : b.tested ? 1 : 0,
          row.id,
        );
        return { body: { pack: summary(visible(row.id, user), user) } };
      },
    },
    {
      // Unpublish: the pack and its versions are removed. Copies people installed stay theirs.
      method: "DELETE",
      path: "/api/packs/:id",
      auth: "user",
      handler(ctx) {
        const { user, params } = ctx as AuthedCtx;
        const row = visible(params.id!, user);
        if (row.owner_id !== user.id && !user.isAdmin) throw forbidden("Only the author can unpublish this pack");
        db.run("DELETE FROM packs WHERE id = ?", row.id);
        return { status: 204 };
      },
    },
    {
      method: "PUT",
      path: "/api/packs/:id/rating",
      auth: "user",
      handler(ctx) {
        const { user, params } = ctx as AuthedCtx;
        const row = visible(params.id!, user);
        if (row.owner_id === user.id) throw new ApiError(403, "own_pack", "You cannot rate your own pack");
        const b = parse(RatingBody, ctx.body);
        db.run(
          "INSERT INTO ratings (pack_id, user_id, stars, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (pack_id, user_id) DO UPDATE SET stars = excluded.stars",
          row.id, user.id, b.stars, config.now(),
        );
        const s = summary(visible(row.id, user), user);
        return { body: { rating: s.rating, myRating: b.stars } };
      },
    },
    {
      method: "DELETE",
      path: "/api/packs/:id/rating",
      auth: "user",
      handler(ctx) {
        const { user, params } = ctx as AuthedCtx;
        const row = visible(params.id!, user);
        db.run("DELETE FROM ratings WHERE pack_id = ? AND user_id = ?", row.id, user.id);
        return { body: { rating: summary(visible(row.id, user), user).rating, myRating: null } };
      },
    },
    {
      method: "POST",
      path: "/api/packs/:id/reports",
      auth: "user",
      limit: "publish",
      handler(ctx) {
        const { user, params } = ctx as AuthedCtx;
        const row = visible(params.id!, user);
        const b = parse(ReportBody, ctx.body);
        db.run("INSERT INTO reports (id, pack_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?, ?)", newId(), row.id, user.id, b.reason, config.now());
        return { status: 201, body: { ok: true } };
      },
    },
    {
      // Counts an install once per account, or once per address and day without one.
      method: "POST",
      path: "/api/packs/:id/installed",
      auth: "optional",
      handler({ params, user, ip }) {
        const row = visible(params.id!, user);
        const day = new Date(config.now()).toISOString().slice(0, 10);
        const who = user ? `u:${user.id}` : `ip:${createHash("sha256").update(`${ip}|${day}`).digest("hex").slice(0, 32)}`;
        const counted = db.tx(() => {
          const added = db.run("INSERT OR IGNORE INTO installs (pack_id, who, created_at) VALUES (?, ?, ?)", row.id, who, config.now());
          if (added) db.run("UPDATE packs SET downloads = downloads + 1 WHERE id = ?", row.id);
          return added > 0;
        });
        return { body: { counted, downloads: row.downloads + (counted ? 1 : 0) } };
      },
    },

    // --- Admin ---------------------------------------------------------------
    {
      method: "GET",
      path: "/api/admin/reports",
      auth: "admin",
      handler({ query }) {
        const all = query.get("all") === "1";
        const rows = db.all<{ id: string; pack_id: string; pack_name: string; hidden: number; reporter: string | null; reason: string; created_at: number; resolved_at: number | null }>(
          `SELECT r.id, r.pack_id, p.name AS pack_name, p.hidden, u.display_name AS reporter, r.reason, r.created_at, r.resolved_at
           FROM reports r JOIN packs p ON p.id = r.pack_id LEFT JOIN users u ON u.id = r.reporter_id
           ${all ? "" : "WHERE r.resolved_at IS NULL"} ORDER BY r.created_at DESC LIMIT 200`,
        );
        return {
          body: {
            items: rows.map((r) => ({
              id: r.id,
              pack: { id: r.pack_id, name: r.pack_name, hidden: !!r.hidden },
              reporter: r.reporter,
              reason: r.reason,
              createdAt: r.created_at,
              resolvedAt: r.resolved_at,
            })),
          },
        };
      },
    },
    {
      method: "POST",
      path: "/api/admin/reports/:id/resolve",
      auth: "admin",
      handler({ params }) {
        if (!db.run("UPDATE reports SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL", config.now(), params.id!)) throw notFound("Report not found");
        return { status: 204 };
      },
    },
    {
      method: "PATCH",
      path: "/api/admin/packs/:id",
      auth: "admin",
      handler(ctx) {
        const { user, params } = ctx as AuthedCtx;
        const row = visible(params.id!, user);
        const b = parse(AdminPackBody, ctx.body);
        db.run(
          "UPDATE packs SET hidden = ?, verified = ? WHERE id = ?",
          b.hidden === undefined ? row.hidden : b.hidden ? 1 : 0,
          b.verified === undefined ? row.verified : b.verified ? 1 : 0,
          row.id,
        );
        return { body: { pack: summary(visible(row.id, user), user) } };
      },
    },
  ];
}
