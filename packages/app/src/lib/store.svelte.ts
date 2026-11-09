import {
  buildProject,
  FACTORY_PRESETS,
  FileFormatError,
  localName,
  loadProject,
  loadShop,
  type CabinetResult,
  type ProjectResult,
  type Shop,
} from "@cabinet-planner/engine";
import { createTranslator, matchLocale, type Translator } from "@cabinet-planner/i18n";
import exampleProject from "../../../../examples/kitchen-basic.project.json";
import exampleShop from "../../../../examples/shop.json";

/** Raw, editable documents (JSON as stored in files). */
type Doc = Record<string, any>;

const KEY_PROJECT = "cabinet-planner.project.v1";
const KEY_SHOP = "cabinet-planner.shop.v1";
const KEY_UI = "cabinet-planner.ui.v1";

function read(key: string): Doc | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}
export function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the app still works for this session */
  }
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export type Tab = "view" | "cutlist" | "drawings" | "hardware";
export type Layer = "cabinet" | "project" | "shop";

export interface BuildState {
  result?: ProjectResult;
  shop?: Shop;
  error?: string;
}

function build(project: Doc, shop: Doc): BuildState {
  try {
    const s = loadShop(shop);
    return { result: buildProject(loadProject(project), s), shop: s };
  } catch (e) {
    if (e instanceof FileFormatError) return { error: e.message };
    return { error: String((e as Error)?.message ?? e) };
  }
}

class Store {
  project = $state<Doc>(read(KEY_PROJECT) ?? clone(exampleProject));
  shop = $state<Doc>(read(KEY_SHOP) ?? clone(exampleShop));
  ui = $state({
    lang: matchLocale(typeof navigator !== "undefined" ? navigator.language : "en"),
    tab: "view" as Tab,
    layer: "cabinet" as Layer,
    selected: "B01" as string | null,
    part: null as string | null,
    explode: false,
    ops: true,
    fronts: true,
    style: "machine",
    ...(read(KEY_UI) ?? {}),
  });

  built: BuildState = $derived(build($state.snapshot(this.project), $state.snapshot(this.shop)));
  tr: Translator = $derived(createTranslator(this.ui.lang));

  /** Display name of a preset (factory, shop or project). */
  presetName(id: string): string {
    const p =
      this.result?.project.library.presets.find((x) => x.id === id) ??
      this.built.shop?.library.presets.find((x) => x.id === id) ??
      FACTORY_PRESETS.find((x) => x.id === id);
    return p ? localName(p.name, this.ui.lang) : id;
  }

  get result(): ProjectResult | undefined {
    return this.built.result;
  }

  get cabinet(): CabinetResult | undefined {
    return this.result?.cabinets.find((c) => c.resolved.cabinet.id === this.ui.selected);
  }

  /** The raw cabinet document being edited. */
  get cabinetDoc(): Doc | undefined {
    return this.project.cabinets?.find((c: Doc) => c.id === this.ui.selected);
  }

  /** The raw layer the inspector writes to. */
  layerDoc(layer: Layer): Doc | undefined {
    if (layer === "cabinet") return this.cabinetDoc;
    if (layer === "project") return this.project;
    this.shop.defaults ??= { presets: [], vars: {}, options: {} };
    return this.shop.defaults;
  }

  save(): void {
    write(KEY_PROJECT, $state.snapshot(this.project));
    write(KEY_SHOP, $state.snapshot(this.shop));
    write(KEY_UI, { lang: this.ui.lang, style: this.ui.style, ops: this.ui.ops });
  }

  resetToExample(): void {
    this.project = clone(exampleProject);
    this.shop = clone(exampleShop);
    this.ui.selected = "B01";
    this.ui.part = null;
  }
}

export const store = new Store();

// ---------------------------------------------------------------------------
// Cabinet list operations

const PREFIX = { base: "B", wall: "W", tall: "T" } as const;
const PRESET = { base: "base-unit", wall: "wall-unit", tall: "tall-unit" } as const;

export function nextId(kind: keyof typeof PREFIX): string {
  const used = new Set((store.project.cabinets ?? []).map((c: Doc) => c.id));
  for (let i = 1; ; i++) {
    const id = `${PREFIX[kind]}${String(i).padStart(2, "0")}`;
    if (!used.has(id)) return id;
  }
}

export function addCabinet(kind: keyof typeof PREFIX): void {
  const id = nextId(kind);
  store.project.cabinets ??= [];
  store.project.cabinets.push({
    id,
    type: "box",
    kind,
    presets: [PRESET[kind]],
    vars: { W: 600 },
    options: {},
  });
  store.ui.selected = id;
  store.ui.part = null;
}

export function duplicateCabinet(id: string): void {
  const list = store.project.cabinets as Doc[];
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) return;
  const copy = clone($state.snapshot(list[i]!)) as Doc;
  copy.id = nextId((copy.kind ?? "base") as keyof typeof PREFIX);
  list.splice(i + 1, 0, copy);
  store.ui.selected = copy.id;
}

export function removeCabinet(id: string): void {
  const list = store.project.cabinets as Doc[];
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) return;
  list.splice(i, 1);
  store.ui.selected = list[Math.min(i, list.length - 1)]?.id ?? null;
  store.ui.part = null;
}

export function moveCabinet(id: string, by: -1 | 1): void {
  const list = store.project.cabinets as Doc[];
  const i = list.findIndex((c) => c.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return;
  const [c] = list.splice(i, 1);
  list.splice(j, 0, c);
}

export function setKind(kind: keyof typeof PREFIX): void {
  const c = store.cabinetDoc;
  if (!c) return;
  c.kind = kind;
  const others = (c.presets ?? []).filter((p: string) => !Object.values(PRESET).includes(p as never));
  c.presets = [PRESET[kind], ...others];
}

// ---------------------------------------------------------------------------
// Value editing

/** Parses inspector input: a number, an expression, or empty (= inherit). */
export function parseInput(text: string): number | string | undefined {
  const t = text.trim().replace(",", ".");
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) && /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(t) ? n : text.trim();
}

export function setVar(layer: Layer, name: string, value: number | string | undefined): void {
  const doc = store.layerDoc(layer);
  if (!doc) return;
  doc.vars ??= {};
  if (value === undefined) delete doc.vars[name];
  else doc.vars[name] = value;
}

export function setOption(layer: Layer, key: string, value: string | boolean | null | undefined): void {
  const doc = store.layerDoc(layer);
  if (!doc) return;
  doc.options ??= {};
  if (value === undefined) delete doc.options[key];
  else doc.options[key] = value;
}

// ---------------------------------------------------------------------------
// Files

type DownloadsApi = { save(r: { filename: string; data: string }): Promise<unknown> };
let downloadsApi: Promise<DownloadsApi | null> | undefined;

/** Inside a claude.ai artifact the viewer grants saves; elsewhere a plain download. */
function hostDownloads(): Promise<DownloadsApi | null> {
  const c = (globalThis as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (!c?.use) return Promise.resolve(null);
  downloadsApi ??= c.use("downloads").then((d) => (d as DownloadsApi | null) ?? null).catch(() => null);
  return downloadsApi;
}

export type DownloadResult = "saved" | "declined" | "failed";

export async function download(name: string, content: string, type: string): Promise<DownloadResult> {
  const host = await hostDownloads();
  if (host) {
    try {
      await host.save({ filename: name, data: content });
      return "saved";
    } catch (e) {
      return (e as { code?: string })?.code === "declined" ? "declined" : "failed";
    }
  }
  try {
    const url = URL.createObjectURL(new Blob([content], { type }));
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

/** Status line for a download outcome. */
export function downloadNote(r: DownloadResult, file: string, t: (k: string, p?: Record<string, string>) => string): string {
  return r === "saved" ? t("ui.saved", { file }) : r === "declined" ? t("ui.download_declined") : t("ui.download_blocked");
}

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
