import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ServerConfig } from "./config.ts";
import type { Db } from "./db.ts";
import { ApiError, parse, type AuthedCtx, type Route, type User } from "./http.ts";

// --- Passwords: scrypt with a salt per user ---------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const MIN_PASSWORD = 10;

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, keylen, { N, r, p, maxmem: 128 * N * r * 2 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** `scrypt$N$r$p$salt$hash` (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = await derive(password, Buffer.from(salt, "base64url"), Number(N), Number(r), Number(p), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

// A hash to burn the same time on when the account does not exist.
let dummyHash: Promise<string> | undefined;

// --- Sessions ---------------------------------------------------------------

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
export const newId = (): string => randomBytes(9).toString("base64url");

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password: string;
  created_at: number;
}

export class Accounts {
  constructor(
    private db: Db,
    private config: ServerConfig,
  ) {}

  toUser(row: UserRow): User {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      createdAt: row.created_at,
      isAdmin: this.config.adminEmails.includes(row.email),
    };
  }

  /** Creates a session; the token is returned once and stored only as a hash. */
  createSession(userId: string): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString("base64url");
    const now = this.config.now();
    const expiresAt = now + this.config.sessionTtlMs;
    this.db.run("DELETE FROM sessions WHERE expires_at <= ?", now);
    this.db.run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", hashToken(token), userId, now, expiresAt);
    return { token, expiresAt };
  }

  /** The user of a bearer token, or null when it is unknown or expired. */
  authenticate(token: string): { user: User; session: string } | null {
    const session = hashToken(token);
    const row = this.db.get<UserRow & { expires_at: number }>(
      "SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
      session,
    );
    if (!row) return null;
    if (row.expires_at <= this.config.now()) {
      this.db.run("DELETE FROM sessions WHERE token_hash = ?", session);
      return null;
    }
    return { user: this.toUser(row), session };
  }

  byEmail(email: string): UserRow | undefined {
    return this.db.get<UserRow>("SELECT * FROM users WHERE email = ?", email.trim().toLowerCase());
  }

  /** Admin CLI: sets a new password and signs the account out everywhere. */
  async setPassword(email: string, password: string): Promise<boolean> {
    const row = this.byEmail(email);
    if (!row) return false;
    if (password.length < MIN_PASSWORD) throw new Error(`Password needs at least ${MIN_PASSWORD} characters.`);
    const hash = await hashPassword(password);
    this.db.tx(() => {
      this.db.run("UPDATE users SET password = ? WHERE id = ?", hash, row.id);
      this.db.run("DELETE FROM sessions WHERE user_id = ?", row.id);
    });
    return true;
  }
}

// --- Routes -----------------------------------------------------------------

const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "not an e-mail address");
const DisplayName = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[^\s<>@][^<>@\n\r\t]*$/, "invalid characters");
const Password = z.string().max(200);

const RegisterBody = z.object({ email: Email, password: Password, displayName: DisplayName });
const LoginBody = z.object({ email: Email, password: Password });
const ProfileBody = z.object({ displayName: DisplayName });
const PasswordBody = z.object({ currentPassword: Password, newPassword: Password });
const DeleteBody = z.object({ password: Password });

const weak = (): ApiError => new ApiError(400, "weak_password", `Password needs at least ${MIN_PASSWORD} characters`);
const invalidCredentials = (): ApiError => new ApiError(401, "invalid_credentials", "E-mail or password is wrong");
const wrongPassword = (): ApiError => new ApiError(403, "wrong_password", "The current password is wrong");

function uniqueError(e: unknown): ApiError | undefined {
  const msg = String((e as Error)?.message ?? "");
  if (!/UNIQUE constraint failed/i.test(msg)) return undefined;
  return msg.includes("users.email")
    ? new ApiError(409, "email_taken", "An account with this e-mail exists")
    : new ApiError(409, "name_taken", "This display name is taken");
}

export function authRoutes(db: Db, accounts: Accounts, config: ServerConfig): Route[] {
  return [
    {
      method: "POST",
      path: "/api/auth/register",
      auth: "none",
      limit: "auth",
      async handler({ body }) {
        const b = parse(RegisterBody, body);
        if (b.password.length < MIN_PASSWORD) throw weak();
        if (accounts.byEmail(b.email)) throw new ApiError(409, "email_taken", "An account with this e-mail exists");
        const id = newId();
        const hash = await hashPassword(b.password);
        try {
          db.run("INSERT INTO users (id, email, display_name, password, created_at) VALUES (?, ?, ?, ?, ?)", id, b.email, b.displayName, hash, config.now());
        } catch (e) {
          throw uniqueError(e) ?? e;
        }
        const user = accounts.toUser(accounts.byEmail(b.email)!);
        return { status: 201, body: { ...accounts.createSession(id), user } };
      },
    },
    {
      method: "POST",
      path: "/api/auth/login",
      auth: "none",
      limit: "auth",
      async handler({ body }) {
        const b = parse(LoginBody, body);
        const row = accounts.byEmail(b.email);
        dummyHash ??= hashPassword("no-such-account");
        const ok = await verifyPassword(b.password, row?.password ?? (await dummyHash));
        if (!row || !ok) throw invalidCredentials();
        return { body: { ...accounts.createSession(row.id), user: accounts.toUser(row) } };
      },
    },
    {
      method: "POST",
      path: "/api/auth/logout",
      auth: "user",
      handler({ session }) {
        db.run("DELETE FROM sessions WHERE token_hash = ?", session);
        return { status: 204 };
      },
    },
    {
      method: "GET",
      path: "/api/me",
      auth: "user",
      handler: ({ user }) => ({ body: { user } }),
    },
    {
      method: "PATCH",
      path: "/api/me",
      auth: "user",
      handler(ctx) {
        const { user } = ctx as AuthedCtx;
        const b = parse(ProfileBody, ctx.body);
        try {
          db.run("UPDATE users SET display_name = ? WHERE id = ?", b.displayName, user.id);
        } catch (e) {
          throw uniqueError(e) ?? e;
        }
        return { body: { user: { ...user, displayName: b.displayName } } };
      },
    },
    {
      method: "POST",
      path: "/api/me/password",
      auth: "user",
      limit: "auth",
      async handler(ctx) {
        const { user, session } = ctx as AuthedCtx;
        const b = parse(PasswordBody, ctx.body);
        const row = accounts.byEmail(user.email)!;
        if (!(await verifyPassword(b.currentPassword, row.password))) throw wrongPassword();
        if (b.newPassword.length < MIN_PASSWORD) throw weak();
        const hash = await hashPassword(b.newPassword);
        db.tx(() => {
          db.run("UPDATE users SET password = ? WHERE id = ?", hash, user.id);
          // Other devices have to sign in again.
          db.run("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", user.id, session);
        });
        return { status: 204 };
      },
    },
    {
      // Deleting an account removes its sessions, synced documents, ratings
      // and packs (with their versions). Reports it filed stay, without a name.
      method: "DELETE",
      path: "/api/me",
      auth: "user",
      limit: "auth",
      async handler(ctx) {
        const { user } = ctx as AuthedCtx;
        const b = parse(DeleteBody, ctx.body);
        const row = accounts.byEmail(user.email)!;
        if (!(await verifyPassword(b.password, row.password))) throw wrongPassword();
        db.run("DELETE FROM users WHERE id = ?", user.id);
        return { status: 204 };
      },
    },
  ];
}
