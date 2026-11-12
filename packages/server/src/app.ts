import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Accounts, authRoutes } from "./auth.ts";
import { DEFAULT_CONFIG, type ServerConfig } from "./config.ts";
import { Db } from "./db.ts";
import { ApiError, clientIp, DEFAULT_MAX_BODY, matchPath, RateLimiter, readJson, type Ctx, type Route } from "./http.ts";
import { LICENCES, packRoutes } from "./packs.ts";
import { syncRoutes } from "./sync.ts";

export const API_VERSION = 1;
export const SERVER_VERSION = "0.1.0";

export interface App {
  server: Server;
  db: Db;
  accounts: Accounts;
  config: ServerConfig;
  /** Starts listening; resolves with the base URL. */
  listen(): Promise<string>;
  close(): Promise<void>;
}

export function createApp(overrides: Partial<ServerConfig> = {}): App {
  const config: ServerConfig = { ...DEFAULT_CONFIG, ...overrides };
  const db = new Db(config.dataDir);
  const accounts = new Accounts(db, config);
  const limiter = new RateLimiter(config.now);

  const routes: Route[] = [
    {
      method: "GET",
      path: "/health",
      auth: "none",
      handler: () => ({ body: { ok: true, name: "cabinet-planner-server", version: SERVER_VERSION, api: API_VERSION, licences: LICENCES, maxContentBytes: config.maxContentBytes } }),
    },
    ...authRoutes(db, accounts, config),
    ...packRoutes(db, config),
    ...syncRoutes(db, config),
  ];

  const anyOrigin = config.corsOrigins.includes("*");
  function cors(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    if (anyOrigin) res.setHeader("Access-Control-Allow-Origin", "*");
    else {
      res.setHeader("Vary", "Origin");
      if (origin && config.corsOrigins.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Expose-Headers", "Retry-After");
    res.setHeader("Access-Control-Max-Age", "600");
  }

  function send(res: ServerResponse, status: number, body?: unknown, headers?: Record<string, string>): void {
    if (res.headersSent) return;
    for (const [k, v] of Object.entries(headers ?? {})) res.setHeader(k, v);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (body === undefined) {
      res.writeHead(status).end();
      return;
    }
    const text = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text) }).end(text);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    cors(req, res);
    if (req.method === "OPTIONS") return send(res, 204);

    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    let route: Route | undefined;
    let params: Record<string, string> = {};
    let pathKnown = false;
    for (const r of routes) {
      const m = matchPath(r.path, path);
      if (!m) continue;
      pathKnown = true;
      if (r.method === req.method) {
        route = r;
        params = m;
        break;
      }
    }
    if (!route) {
      req.resume();
      throw pathKnown ? new ApiError(405, "method_not_allowed", "Method not allowed") : new ApiError(404, "not_found", "No such endpoint");
    }

    const ip = clientIp(req, config.trustProxy);
    if (route.limit) {
      const wait = limiter.take(`${route.limit}|${ip}`, config.rateLimits[route.limit]);
      if (wait) {
        req.resume();
        throw new ApiError(429, "rate_limited", "Too many requests, try again later", { retryAfter: wait }, { "Retry-After": String(wait) });
      }
    }

    const ctx: Ctx = { params, query: url.searchParams, body: undefined, user: null, session: null, ip };
    const header = req.headers.authorization;
    const token = header && /^Bearer\s+\S+$/i.test(header) ? header.replace(/^Bearer\s+/i, "") : null;
    if (route.auth !== "none" && token) {
      const found = accounts.authenticate(token);
      if (found) {
        ctx.user = found.user;
        ctx.session = found.session;
      } else if (route.auth !== "optional") {
        req.resume();
        throw new ApiError(401, "invalid_token", "The session is unknown or has expired");
      }
    }
    if ((route.auth === "user" || route.auth === "admin") && !ctx.user) {
      req.resume();
      throw new ApiError(401, "unauthorized", "Sign in first");
    }
    if (route.auth === "admin" && !ctx.user?.isAdmin) {
      req.resume();
      throw new ApiError(403, "forbidden", "Admins only");
    }

    if (req.method !== "GET") ctx.body = await readJson(req, route.maxBody ?? DEFAULT_MAX_BODY);
    else req.resume();

    const reply = await route.handler(ctx);
    send(res, reply.status ?? 200, reply.body);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (e instanceof ApiError) {
        send(res, e.status, { error: { code: e.code, message: e.message }, ...e.extra }, e.headers);
      } else {
        // Never leak internals: details go to the log only.
        config.log(`error ${req.method} ${req.url}: ${(e as Error)?.stack ?? String(e)}`);
        send(res, 500, { error: { code: "internal", message: "Internal server error" } });
      }
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;

  return {
    server,
    db,
    accounts,
    config,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          const a = server.address() as AddressInfo;
          resolve(`http://${config.host === "0.0.0.0" || config.host === "::" ? "localhost" : config.host}:${a.port}`);
        });
      }),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}
