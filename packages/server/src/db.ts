import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Schema migrations, applied in order at start. The index + 1 is the
 * `user_version` of the database after the step. Never edit a released
 * step: add a new one.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE packs (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    tags TEXT NOT NULL,
    types TEXT NOT NULL,
    counts TEXT NOT NULL,
    licence TEXT NOT NULL,
    language TEXT NOT NULL,
    tested INTEGER NOT NULL DEFAULT 0,
    verified INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    forked_from TEXT,
    latest_version TEXT NOT NULL,
    downloads INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX packs_owner ON packs(owner_id);
  CREATE INDEX packs_updated ON packs(updated_at);
  CREATE TABLE pack_versions (
    pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    changelog TEXT NOT NULL,
    content TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (pack_id, version)
  );
  CREATE TABLE ratings (
    pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stars INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (pack_id, user_id)
  );
  CREATE TABLE reports (
    id TEXT PRIMARY KEY,
    pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
    reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE TABLE installs (
    pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
    who TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (pack_id, who)
  );
  CREATE TABLE sync_docs (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    doc TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind, id)
  );
  `,
];

export type Row = Record<string, string | number | null>;
type Param = string | number | null;

/** Thin typed wrapper: parameterised statements only. */
export class Db {
  readonly raw: DatabaseSync;

  constructor(dataDir: string) {
    if (dataDir === ":memory:") {
      this.raw = new DatabaseSync(":memory:");
    } else {
      mkdirSync(dataDir, { recursive: true });
      this.raw = new DatabaseSync(join(dataDir, "cabinet-planner.sqlite"));
      this.raw.exec("PRAGMA journal_mode = WAL");
    }
    this.raw.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    const current = Number((this.raw.prepare("PRAGMA user_version").get() as Row).user_version ?? 0);
    if (current > MIGRATIONS.length) throw new Error(`Database is newer (version ${current}) than this server (${MIGRATIONS.length}).`);
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.tx(() => {
        this.raw.exec(MIGRATIONS[v]!);
        // PRAGMA takes no parameters; v is our own loop counter.
        this.raw.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  get version(): number {
    return Number((this.raw.prepare("PRAGMA user_version").get() as Row).user_version);
  }

  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }
  all<T = Row>(sql: string, ...params: Param[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }
  /** Runs a statement; returns the number of changed rows. */
  run(sql: string, ...params: Param[]): number {
    return Number(this.raw.prepare(sql).run(...params).changes);
  }

  tx<T>(f: () => T): T {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const out = f();
      this.raw.exec("COMMIT");
      return out;
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }

  close(): void {
    this.raw.close();
  }
}
