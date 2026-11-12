import type { IncomingMessage } from "node:http";
import type { z } from "zod";
import type { RateLimit } from "./config.ts";

/**
 * An error the client gets as `{ error: { code, message } }`. Codes are
 * stable and translated by the app; `message` is English for logs and
 * API users, never shown as UI text.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Extra top-level fields of the response (e.g. the server copy on a sync conflict). */
    readonly extra?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown): ApiError =>
  new ApiError(400, "bad_request", message, details === undefined ? undefined : { details });
export const notFound = (what = "Not found"): ApiError => new ApiError(404, "not_found", what);
export const forbidden = (message = "Not allowed"): ApiError => new ApiError(403, "forbidden", message);

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: number;
  isAdmin: boolean;
}

export interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  /** The signed-in user, when the request carries a valid token. */
  user: User | null;
  /** Hash of the session token in use. */
  session: string | null;
  ip: string;
}

/** Context of a route that requires a user. */
export type AuthedCtx = Ctx & { user: User };

export interface Reply {
  status?: number;
  body?: unknown;
}

export interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path with `:name` segments. */
  path: string;
  /** none: no token needed; optional: used when present; user/admin: required. */
  auth: "none" | "optional" | "user" | "admin";
  limit?: "auth" | "publish";
  /** Largest request body in bytes (default 64 kB). */
  maxBody?: number;
  handler: (ctx: Ctx) => Reply | Promise<Reply>;
}

export const DEFAULT_MAX_BODY = 64 * 1024;

/** Matches a path against a route pattern; returns the parameters. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/");
  const b = path.split("/");
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const seg = a[i]!;
    if (seg.startsWith(":")) {
      if (!b[i]) return null;
      try {
        params[seg.slice(1)] = decodeURIComponent(b[i]!);
      } catch {
        return null;
      }
    } else if (seg !== b[i]) return null;
  }
  return params;
}

/** Reads a JSON body up to `max` bytes. */
export function readJson(req: IncomingMessage, max: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tooLarge = (): ApiError => new ApiError(413, "payload_too_large", `Request body is larger than ${max} bytes`, undefined, { Connection: "close" });
    if (Number(req.headers["content-length"] ?? 0) > max) {
      req.resume();
      return reject(tooLarge());
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > max) {
        done = true;
        chunks.length = 0;
        reject(tooLarge());
        return;
      }
      chunks.push(c);
    });
    req.on("error", () => {
      if (!done) reject(badRequest("Request aborted"));
      done = true;
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      if (!size) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new ApiError(400, "invalid_json", "Request body is not valid JSON"));
      }
    });
  });
}

/** Validates with a zod schema; a failure is a 400 with the issue list. */
export function parse<S extends z.ZodType>(schema: S, data: unknown, code = "bad_request"): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const details = r.error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message }));
  throw new ApiError(400, code, details[0] ? `${details[0].path || "body"}: ${details[0].message}` : "Invalid request", { details });
}

/** In-memory token buckets per key (IP + limit name). */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(private now: () => number) {}

  /** Takes one token; returns the seconds to wait when none is left, else 0. */
  take(key: string, limit: RateLimit): number {
    const now = this.now();
    if (this.buckets.size > 20_000) this.prune(now, limit);
    const b = this.buckets.get(key) ?? { tokens: limit.burst, at: now };
    const perMs = limit.perMinute / 60_000;
    b.tokens = Math.min(limit.burst, b.tokens + (now - b.at) * perMs);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens < 1) return Math.max(1, Math.ceil((1 - b.tokens) / perMs / 1000));
    b.tokens -= 1;
    return 0;
  }

  private prune(now: number, limit: RateLimit): void {
    const idle = (limit.burst / limit.perMinute) * 60_000;
    for (const [k, b] of this.buckets) if (now - b.at > idle) this.buckets.delete(k);
  }
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = String(req.headers["x-forwarded-for"] ?? "")
      .split(",")[0]
      ?.trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress ?? "unknown";
}
