/**
 * Platform layer: everything the app needs from its host, so the same UI
 * runs in a browser (PWA), in the Tauri desktop/tablet shell and inside a
 * claude.ai artifact.
 *
 * - kv: small async key/value store for documents (IndexedDB; localStorage
 *   when IndexedDB is unavailable; memory as a last resort).
 * - saveFile / openFile: native dialogs in Tauri, the File System Access API
 *   where the browser has it, else a download / a file input.
 */

export type HostKind = "tauri" | "artifact" | "web";
export type SaveResult = "saved" | "cancelled" | "declined" | "failed";

export interface OpenedFile {
  name: string;
  text: string;
}

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

const g = globalThis as Record<string, unknown>;

export function hostKind(): HostKind {
  if (g.__TAURI_INTERNALS__) return "tauri";
  if ((g.claude as { use?: unknown } | undefined)?.use) return "artifact";
  return "web";
}

// ---------------------------------------------------------------------------
// Key/value storage

function idbKV(): Promise<KV> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no IndexedDB"));
    const req = indexedDB.open("cabinet-planner", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const run = <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
        new Promise((res, rej) => {
          const r = f(db.transaction("kv", mode).objectStore("kv"));
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      resolve({
        get: <T>(k: string) => run<T | undefined>("readonly", (s) => s.get(k) as IDBRequest<T | undefined>),
        set: async (k, v) => void (await run("readwrite", (s) => s.put(v, k))),
        del: async (k) => void (await run("readwrite", (s) => s.delete(k))),
        keys: async (p) => ((await run("readonly", (s) => s.getAllKeys())) as IDBValidKey[]).map(String).filter((k) => k.startsWith(p)),
      });
    };
  });
}

function localKV(): KV {
  const mem = new Map<string, string>();
  const ls = (): Storage | undefined => {
    try {
      return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
      return undefined;
    }
  };
  const P = "cabinet-planner.kv.";
  return {
    async get(k) {
      try {
        const raw = ls()?.getItem(P + k) ?? mem.get(k);
        return raw === undefined || raw === null ? undefined : JSON.parse(raw);
      } catch {
        return undefined;
      }
    },
    async set(k, v) {
      const raw = JSON.stringify(v);
      mem.set(k, raw);
      try {
        ls()?.setItem(P + k, raw);
      } catch {
        /* quota or blocked: memory only */
      }
    },
    async del(k) {
      mem.delete(k);
      try {
        ls()?.removeItem(P + k);
      } catch {
        /* ignore */
      }
    },
    async keys(p) {
      const out = new Set([...mem.keys()].filter((k) => k.startsWith(p)));
      try {
        const s = ls();
        for (let i = 0; s && i < s.length; i++) {
          const k = s.key(i);
          if (k?.startsWith(P + p)) out.add(k.slice(P.length));
        }
      } catch {
        /* ignore */
      }
      return [...out];
    },
  };
}

let kvPromise: Promise<KV> | undefined;
export function kv(): Promise<KV> {
  kvPromise ??= idbKV().catch(() => localKV());
  return kvPromise;
}

// ---------------------------------------------------------------------------
// Files

type DownloadsApi = { save(r: { filename: string; data: string | Uint8Array }): Promise<unknown> };
let downloadsApi: Promise<DownloadsApi | null> | undefined;
function artifactDownloads(): Promise<DownloadsApi | null> {
  const c = g.claude as { use?: (n: string) => Promise<unknown> } | undefined;
  if (!c?.use) return Promise.resolve(null);
  downloadsApi ??= c.use("downloads").then((d) => (d as DownloadsApi | null) ?? null).catch(() => null);
  return downloadsApi;
}

const extOf = (name: string): string => name.slice(name.lastIndexOf(".") + 1);

/** Save a file: native dialog (Tauri), save picker (Chromium), host save (artifact) or download. */
export async function saveFile(name: string, content: string | Uint8Array, type: string): Promise<SaveResult> {
  const host = hostKind();
  if (host === "tauri") {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeFile, writeTextFile } = await import("@tauri-apps/plugin-fs");
      const path = await save({ defaultPath: name, filters: [{ name: extOf(name).toUpperCase(), extensions: [extOf(name)] }] });
      if (!path) return "cancelled";
      if (typeof content === "string") await writeTextFile(path, content);
      else await writeFile(path, content);
      return "saved";
    } catch {
      return "failed";
    }
  }
  if (host === "artifact") {
    const api = await artifactDownloads();
    if (api) {
      try {
        await api.save({ filename: name, data: content });
        return "saved";
      } catch (e) {
        return (e as { code?: string })?.code === "declined" ? "declined" : "failed";
      }
    }
  }
  const picker = g.showSaveFilePicker as
    | ((o: object) => Promise<{ createWritable(): Promise<{ write(d: BlobPart): Promise<void>; close(): Promise<void> }> }>)
    | undefined;
  if (picker && g.top === g.self) {
    try {
      const h = await picker({ suggestedName: name, types: [{ description: extOf(name), accept: { [type]: [`.${extOf(name)}`] } }] });
      const w = await h.createWritable();
      await w.write(content as BlobPart);
      await w.close();
      return "saved";
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return "cancelled";
      // fall through to a plain download
    }
  }
  try {
    const url = URL.createObjectURL(new Blob([content as BlobPart], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return "saved";
  } catch {
    return "failed";
  }
}

/** Ask for a text file: native dialog in Tauri, else a file input. */
export async function openFile(extensions: string[]): Promise<OpenedFile | null> {
  if (hostKind() === "tauri") {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({ multiple: false, filters: [{ name: extensions.join(", "), extensions }] });
    if (!path || Array.isArray(path)) return null;
    return { name: String(path).split(/[\\/]/).pop() ?? String(path), text: await readTextFile(String(path)) };
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = extensions.map((e) => `.${e}`).join(",");
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
