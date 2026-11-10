/** Server configuration. `fromEnv` reads the documented variables; tests pass overrides. */

export interface RateLimit {
  /** Requests allowed at once. */
  burst: number;
  /** Tokens added per minute. */
  perMinute: number;
}

export interface ServerConfig {
  port: number;
  host: string;
  /** Folder of the SQLite file, or ":memory:" (tests). */
  dataDir: string;
  /** Lower-case e-mail addresses with admin rights. */
  adminEmails: string[];
  /** Allowed CORS origins; "*" allows any (auth is a bearer header, not a cookie). */
  corsOrigins: string[];
  /** Take the client address from X-Forwarded-For (only behind a reverse proxy). */
  trustProxy: boolean;
  sessionTtlMs: number;
  /** Largest pack content (JSON bytes). */
  maxContentBytes: number;
  /** Largest synced document (JSON bytes). */
  maxSyncBytes: number;
  rateLimits: { auth: RateLimit; publish: RateLimit };
  /** Clock, replaceable in tests. */
  now: () => number;
  log: (line: string) => void;
}

const DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_CONFIG: ServerConfig = {
  port: 8787,
  host: "0.0.0.0",
  dataDir: "./data",
  adminEmails: [],
  corsOrigins: ["*"],
  trustProxy: false,
  sessionTtlMs: 30 * DAY,
  maxContentBytes: 512 * 1024,
  maxSyncBytes: 2 * 1024 * 1024,
  rateLimits: { auth: { burst: 10, perMinute: 10 }, publish: { burst: 10, perMinute: 6 } },
  now: () => Date.now(),
  log: (line) => console.log(line),
};

const list = (v: string | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function fromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT);
  const origins = list(env.CORS_ORIGINS);
  return {
    ...DEFAULT_CONFIG,
    port: Number.isInteger(port) && port > 0 ? port : DEFAULT_CONFIG.port,
    host: env.HOST?.trim() || DEFAULT_CONFIG.host,
    dataDir: env.DATA_DIR?.trim() || DEFAULT_CONFIG.dataDir,
    adminEmails: list(env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
    corsOrigins: origins.length ? origins : ["*"],
    trustProxy: env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true",
  };
}
