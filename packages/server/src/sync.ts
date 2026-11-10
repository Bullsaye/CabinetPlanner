import { z } from "zod";
import type { ServerConfig } from "./config.ts";
import type { Db } from "./db.ts";
import { ApiError, badRequest, notFound, parse, type AuthedCtx, type Route } from "./http.ts";

/**
 * Document sync: one JSON document per user, kind and id, with a revision
 * counter the server increases on every write. A write names the revision
 * it was based on; when the server copy moved on, the client gets it back
 * with 409 and decides (the app: last writer wins, the other copy is kept).
 */

const Name = /^[a-z][a-z0-9_-]{0,39}$/;
const MAX_DOCS_PER_USER = 500;

const PutBody = z.object({
  /** Revision this write is based on; 0 for a document that should not exist yet. */
  baseRevision: z.number().int().min(0),
  doc: z.record(z.string(), z.unknown()),
});

interface DocRow {
  kind: string;
  id: string;
  revision: number;
  doc: string;
  updated_at: number;
}

const view = (r: DocRow): Record<string, unknown> => ({ kind: r.kind, id: r.id, revision: r.revision, updatedAt: r.updated_at, doc: JSON.parse(r.doc) });

export function syncRoutes(db: Db, config: ServerConfig): Route[] {
  const names = (params: Record<string, string>): { kind: string; id: string } => {
    const { kind, id } = params;
    if (!kind || !Name.test(kind) || (id !== undefined && !Name.test(id))) throw badRequest("Invalid document kind or id");
    return { kind, id: id ?? "" };
  };
  const find = (user: string, kind: string, id: string): DocRow | undefined =>
    db.get<DocRow>("SELECT kind, id, revision, doc, updated_at FROM sync_docs WHERE user_id = ? AND kind = ? AND id = ?", user, kind, id);

  return [
    {
      method: "GET",
      path: "/api/sync/docs/:kind",
      auth: "user",
      handler(ctx) {
        const { user, params } = ctx as AuthedCtx;
        const { kind } = names(params);
        const rows = db.all<DocRow>("SELECT kind, id, revision, updated_at FROM sync_docs WHERE user_id = ? AND kind = ? ORDER BY id", user.id, kind);
        return { body: { items: rows.map((r) => ({ kind: r.kind, id: r.id, revision: r.revision, updatedAt: r.updated_at })) } };
      },
    },
    {
      method: "GET",
      path: "/api/sync/docs/:kind/:id",
      auth: "user",
      handler(ctx) {
        const { user, params } = ctx as AuthedCtx;
        const { kind, id } = names(params);
        const row = find(user.id, kind, id);
        if (!row) throw notFound("Document not found");
        return { body: view(row) };
      },
    },
    {
      method: "PUT",
      path: "/api/sync/docs/:kind/:id",
      auth: "user",
      maxBody: config.maxSyncBytes + 4096,
      handler(ctx) {
        const { user, params } = ctx as AuthedCtx;
        const { kind, id } = names(params);
        const b = parse(PutBody, ctx.body);
        const json = JSON.stringify(b.doc);
        if (Buffer.byteLength(json, "utf8") > config.maxSyncBytes) throw new ApiError(413, "payload_too_large", `Document is larger than ${config.maxSyncBytes} bytes`);
        const now = config.now();
        const saved = db.tx(() => {
          const row = find(user.id, kind, id);
          if ((row?.revision ?? 0) !== b.baseRevision) {
            throw new ApiError(409, "conflict", "The document changed on the server", { current: row ? view(row) : null });
          }
          if (!row) {
            const n = Number(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sync_docs WHERE user_id = ?", user.id)?.n ?? 0);
            if (n >= MAX_DOCS_PER_USER) throw new ApiError(403, "quota_exceeded", "Too many synced documents");
            db.run("INSERT INTO sync_docs (user_id, kind, id, revision, doc, updated_at) VALUES (?, ?, ?, 1, ?, ?)", user.id, kind, id, json, now);
            return 1;
          }
          db.run("UPDATE sync_docs SET revision = revision + 1, doc = ?, updated_at = ? WHERE user_id = ? AND kind = ? AND id = ?", json, now, user.id, kind, id);
          return row.revision + 1;
        });
        return { body: { kind, id, revision: saved, updatedAt: now } };
      },
    },
    {
      method: "DELETE",
      path: "/api/sync/docs/:kind/:id",
      auth: "user",
      handler(ctx) {
        const { user, params } = ctx as AuthedCtx;
        const { kind, id } = names(params);
        if (!db.run("DELETE FROM sync_docs WHERE user_id = ? AND kind = ? AND id = ?", user.id, kind, id)) throw notFound("Document not found");
        return { status: 204 };
      },
    },
  ];
}
