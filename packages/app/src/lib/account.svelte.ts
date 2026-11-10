/**
 * Optional account: session, server address and sync of the shop library.
 * The app works without any of it; nothing here runs until a server is
 * configured, and every network failure ends as a status, never an error
 * in the UI.
 *
 * Shop sync (PLAN.md "Sync"): one document per account with a server
 * revision. Last writer wins; when both sides changed, the losing copy is
 * kept as a conflict copy the user can download or restore.
 */
import { loadShop } from "@cabinet-planner/engine";
import { CloudClient, CloudError, isCloudError, isConnectionError, normalizeServerUrl, type CloudUser, type Doc, type Session, type SyncDoc } from "./cloud.ts";
import { hashText } from "./packs.ts";
import { kv } from "./platform.ts";
import { store } from "./store.svelte.ts";
import exampleShop from "../../../../examples/shop.json";

const KEY_URL = "cloud.url";
const KEY_SESSION = "cloud.session";
const KEY_SYNC = "cloud.sync.shop";
const KEY_CHANGED = "cloud.shop.changedAt";
const KEY_CONFLICT = "cloud.shop.conflict";
const PUSH_DELAY_MS = 2500;

/** What the last sync knew: server revision and the content hash at that point. */
interface SyncBase {
  user: string;
  url: string;
  revision: number;
  hash: string;
}

export interface ConflictCopy {
  doc: Doc;
  /** When the copy was set aside. */
  at: number;
  /** Where the kept copy came from: the server, or this device. */
  source: "server" | "device";
}

export type ServerStatus = "none" | "checking" | "online" | "unreachable";
export type SyncState = "off" | "idle" | "syncing" | "offline" | "error";

// Built-in server address (may be empty: then the user enters one).
const DEFAULT_URL = normalizeServerUrl(String((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_CLOUD_URL ?? ""));
const hashDoc = (doc: Doc): string => hashText(JSON.stringify(doc));
/** The library a fresh install starts with: a device that still has it has nothing of its own to lose. */
const PRISTINE_HASH = hashDoc(exampleShop);

class Account {
  /** Server address in use ("" = none configured). */
  url = $state(DEFAULT_URL);
  /** True when the user set an address that differs from the built-in one. */
  customUrl = $state(false);
  user = $state<CloudUser | null>(null);
  server = $state<ServerStatus>(DEFAULT_URL ? "checking" : "none");
  sync = $state<{ state: SyncState; at: number | null; error: string | null }>({ state: "off", at: null, error: null });
  conflict = $state<ConflictCopy | null>(null);
  /** Account dialog. */
  open = $state(false);
  ready = $state(false);

  private token: string | null = null;
  private knownHash: string | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private again = false;

  get client(): CloudClient {
    return new CloudClient(this.url, () => this.token);
  }
  get defaultUrl(): string {
    return DEFAULT_URL;
  }
  get signedIn(): boolean {
    return this.user !== null;
  }

  /** Restores address and session, checks them, pulls the shop library. Call once after the store has booted. */
  async boot(): Promise<void> {
    const db = await kv();
    const saved = await db.get<string>(KEY_URL);
    if (saved !== undefined) {
      this.url = normalizeServerUrl(saved);
      this.customUrl = this.url !== DEFAULT_URL;
    }
    const session = await db.get<{ token: string; user: CloudUser; url: string }>(KEY_SESSION);
    if (session && session.url === this.url) {
      this.token = session.token;
      this.user = session.user;
    }
    this.conflict = (await db.get<ConflictCopy>(KEY_CONFLICT)) ?? null;
    this.ready = true;
    this.watchShop();
    if (typeof window !== "undefined") window.addEventListener("online", () => void this.refresh());
    await this.refresh();
  }

  /** Asks the server who we are; keeps the session when it cannot be reached. */
  async refresh(): Promise<void> {
    if (!this.url) {
      this.server = "none";
      return;
    }
    if (this.server !== "online") this.server = "checking";
    try {
      if (this.token) this.user = await this.client.me();
      else await this.client.health();
      this.server = "online";
    } catch (e) {
      if (isCloudError(e, "invalid_token") || isCloudError(e, "unauthorized")) {
        this.server = "online";
        await this.forget();
      } else {
        this.server = "unreachable";
        if (this.user) this.sync = { ...this.sync, state: "offline" };
      }
      return;
    }
    if (this.user) {
      await this.saveSession();
      await this.syncShop();
    }
  }

  /** Sets the server address ("" = back to the built-in one); signs out when it changes. Throws CloudError when it is not a server. */
  async setUrl(input: string): Promise<void> {
    const url = input.trim() ? normalizeServerUrl(input) : DEFAULT_URL;
    if (input.trim() && !url) throw new CloudError("bad_url");
    if (url) await new CloudClient(url).health();
    if (url !== this.url) await this.forget();
    this.url = url;
    this.customUrl = url !== DEFAULT_URL;
    this.server = url ? "online" : "none";
    const db = await kv();
    if (this.customUrl) await db.set(KEY_URL, url);
    else await db.del(KEY_URL);
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.adopt(await this.client.login(email, password));
  }
  async register(email: string, password: string, displayName: string): Promise<void> {
    await this.adopt(await this.client.register(email, password, displayName));
  }
  private async adopt(s: Session): Promise<void> {
    this.token = s.token;
    this.user = s.user;
    this.server = "online";
    await this.saveSession();
    await this.syncShop();
  }

  async signOut(): Promise<void> {
    try {
      await this.client.logout();
    } catch {
      /* the local session ends either way */
    }
    await this.forget();
  }

  async setDisplayName(name: string): Promise<void> {
    this.user = await this.client.setDisplayName(name);
    await this.saveSession();
  }
  changePassword(current: string, next: string): Promise<void> {
    return this.client.changePassword(current, next);
  }
  async deleteAccount(password: string): Promise<void> {
    await this.client.deleteAccount(password);
    await this.forget();
  }

  private async saveSession(): Promise<void> {
    if (this.token && this.user) await (await kv()).set(KEY_SESSION, { token: this.token, user: $state.snapshot(this.user), url: this.url });
  }
  /** Ends the local session. The library stays on the device. */
  private async forget(): Promise<void> {
    this.token = null;
    this.user = null;
    clearTimeout(this.pushTimer);
    this.sync = { state: "off", at: null, error: null };
    const db = await kv();
    await db.del(KEY_SESSION);
    await db.del(KEY_SYNC);
  }

  /** A request failed with 401: the session ended on the server. */
  async sessionLost(e: unknown): Promise<boolean> {
    if (!isCloudError(e, "invalid_token") && !isCloudError(e, "unauthorized")) return false;
    await this.forget();
    return true;
  }

  // --- Shop sync ----------------------------------------------------------------

  /** Notes local changes of the shop library and pushes them a moment later. */
  private watchShop(): void {
    $effect.root(() => {
      $effect(() => {
        const hash = hashDoc($state.snapshot(store.shop));
        if (!store.ready) return;
        if (this.knownHash === null) {
          this.knownHash = hash;
          return;
        }
        if (hash === this.knownHash) return;
        this.knownHash = hash;
        void kv().then((db) => db.set(KEY_CHANGED, Date.now()));
        if (!this.token) return;
        clearTimeout(this.pushTimer);
        this.pushTimer = setTimeout(() => void this.syncShop(), PUSH_DELAY_MS);
      });
    });
  }

  /** Brings the shop library and the server copy together. Safe to call any time. */
  syncShop(): Promise<void> {
    if (!this.token || !this.user) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    clearTimeout(this.pushTimer);
    this.sync = { ...this.sync, state: "syncing", error: null };
    this.running = this.syncOnce()
      .then(() => {
        this.sync = { state: "idle", at: Date.now(), error: null };
      })
      .catch(async (e: unknown) => {
        if (await this.sessionLost(e)) return;
        if (isConnectionError(e)) {
          this.server = "unreachable";
          this.sync = { ...this.sync, state: "offline", error: null };
        } else {
          this.sync = { ...this.sync, state: "error", error: e instanceof CloudError ? e.code : "unknown" };
        }
      })
      .finally(() => {
        this.running = null;
        if (this.again) {
          this.again = false;
          void this.syncShop();
        }
      });
    return this.running;
  }

  private async syncOnce(): Promise<void> {
    const db = await kv();
    const user = this.user!.id;
    const client = this.client;
    const local = $state.snapshot(store.shop) as Doc;
    const localHash = hashDoc(local);
    let base = await db.get<SyncBase>(KEY_SYNC);
    if (base && (base.user !== user || base.url !== this.url)) base = undefined;
    const remote = await client.getDoc("shop", "default");
    this.server = "online";

    const setBase = (revision: number, hash: string): Promise<void> => db.set(KEY_SYNC, { user, url: this.url, revision, hash } satisfies SyncBase);
    const push = async (baseRevision: number): Promise<void> => {
      let rev = baseRevision;
      for (let attempt = 0; ; attempt++) {
        try {
          const saved = await client.putDoc("shop", "default", rev, local);
          await setBase(saved.revision, localHash);
          return;
        } catch (e) {
          // Another device wrote in between: we are the last writer, its copy is kept.
          if (!isCloudError(e, "conflict") || attempt >= 3) throw e;
          const current = e.data.current as SyncDoc | null;
          if (current) await this.keep(current.doc, "server");
          rev = current?.revision ?? 0;
        }
      }
    };
    const take = async (r: SyncDoc): Promise<void> => {
      loadShop(r.doc); // throws when the server copy is not a shop file this version reads
      const hash = hashDoc(r.doc);
      this.knownHash = hash;
      store.shop = r.doc;
      await setBase(r.revision, hash);
    };

    if (!remote) return push(0);
    const remoteHash = hashDoc(remote.doc);
    if (remoteHash === localHash) return setBase(remote.revision, remoteHash);
    if (base && remote.revision === base.revision) return push(base.revision); // only this device changed
    if (base && localHash === base.hash) return take(remote); // only the server changed
    if (!base && localHash === PRISTINE_HASH) return take(remote); // fresh device: nothing of its own yet

    // Both changed (or first sync of a device with its own library): the later one wins.
    const localAt = (await db.get<number>(KEY_CHANGED)) ?? 0;
    if (localAt >= remote.updatedAt) {
      await this.keep(remote.doc, "server");
      await push(remote.revision);
    } else {
      await this.keep(local, "device");
      await take(remote);
    }
  }

  private async keep(doc: Doc, source: ConflictCopy["source"]): Promise<void> {
    this.conflict = { doc, at: Date.now(), source };
    await (await kv()).set(KEY_CONFLICT, $state.snapshot(this.conflict));
  }

  /** Makes the kept copy the library again (the current one becomes the kept copy). */
  async restoreConflict(): Promise<void> {
    const c = this.conflict;
    if (!c) return;
    const current = $state.snapshot(store.shop) as Doc;
    store.shop = $state.snapshot(c.doc) as Doc;
    await this.keep(current, "device");
  }
  async discardConflict(): Promise<void> {
    this.conflict = null;
    await (await kv()).del(KEY_CONFLICT);
  }
}

export const account = new Account();

/** Text for an error code of the server or the client (`cloud.error.<code>`). */
export function cloudCodeText(code: string, seconds = 60): string {
  const key = `cloud.error.${code}`;
  return store.tr.has(key) ? store.tr.t(key, { seconds }) : store.tr.t("cloud.error.unknown", { code });
}

/** Text for a failed server call: the translated error code. */
export function cloudErrorText(e: unknown): string {
  return e instanceof CloudError ? cloudCodeText(e.code, Number(e.data.retryAfter ?? 60)) : cloudCodeText("unknown");
}
