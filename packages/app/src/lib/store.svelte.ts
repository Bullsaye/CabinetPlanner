import {
  buildProject,
  FACTORY_PRESETS,
  FACTORY_TEMPLATES,
  FileFormatError,
  localName,
  loadProject,
  loadShop,
  type CabinetResult,
  type CabinetTemplate,
  type ProjectResult,
  type Shop,
} from "@cabinet-planner/engine";
import { createTranslator, matchLocale, type Translator } from "@cabinet-planner/i18n";
import { copyText, kv, saveFile, type SaveResult } from "./platform.ts";
import exampleProject from "../../../../examples/kitchen-basic.project.json";
import exampleShop from "../../../../examples/shop.json";

/** Raw, editable documents (JSON as stored in files). */
type Doc = Record<string, any>;

// Pre-1.0 single-project storage, migrated into the project list on first start.
const KEY_PROJECT = "cabinet-planner.project.v1";
const KEY_SHOP = "cabinet-planner.shop.v1";
const KEY_UI = "cabinet-planner.ui.v1";

/** Entry of the local project list. */
export interface ProjectMeta {
  id: string;
  name: string;
  updated: number;
  cabinets: number;
}

function read(key: string): Doc | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The room a new project starts with: a rectangle, walls clockwise (D28). */
export const defaultRoom = (): Doc => ({
  walls: [
    { id: "A", length: 3600 },
    { id: "B", length: 2400 },
    { id: "C", length: 3600 },
    { id: "D", length: 2400 },
  ],
  openings: [],
});

/** A new, empty project: with a rectangular room, or without one (cabinets in a simple run). */
export function blankProject(name: string, withRoom = true): Doc {
  return {
    schemaVersion: 1,
    name,
    revision: 1,
    vars: {},
    ...(withRoom ? { room: defaultRoom() } : {}),
    cabinets: [],
  };
}

/** Width up to which the app counts as narrow (tablet, phone): matches the layout breakpoint in App.svelte. */
const NARROW = "(max-width: 1100px)";
export type ViewMode = "cabinet" | "room";
export type WallsShown = "all" | "used" | "none";
export type HingeSymbol = "tip_at_hinge" | "tip_at_handle";
/** Preferences kept between sessions (D33). */
const PREFS = ["lang", "style", "ops", "fronts", "viewMode", "cabinet3d", "walls", "hingeSymbol"] as const;

export type Tab = "view" | "room" | "cutlist" | "drawings" | "hardware" | "library" | "community";
export type Screen = "home" | "project";
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
  project = $state<Doc>(clone(exampleProject));
  shop = $state<Doc>(clone(exampleShop));
  /** Local project list, newest first. */
  projects = $state<ProjectMeta[]>([]);
  projectId = $state<string | null>(null);
  screen = $state<Screen>("home");
  ready = $state(false);
  ui = $state({
    lang: matchLocale(typeof navigator !== "undefined" ? navigator.language : "en"),
    tab: "view" as Tab,
    layer: "cabinet" as Layer,
    selected: "B01" as string | null,
    part: null as string | null,
    /** Parts highlighted in 3D while a setting about them has focus (D70). */
    highlight: [] as string[],
    explode: false,
    ops: true,
    fronts: true,
    style: "machine",
    panel: null as null | "list" | "inspector",
    /** Right pane: cabinet design, project or shop defaults. */
    pane: "cabinet" as "cabinet" | "project" | "shop",
    /** Cabinet open in the construction editor. */
    construction: null as string | null,
    /** Main view: the selected cabinet alone or the room; null follows the screen width (D68). */
    viewMode: null as ViewMode | null,
    /** Cabinet view: 3D of the single cabinet instead of the front elevation. */
    cabinet3d: false,
    /** Walls drawn in the room 3D view. */
    walls: "used" as WallsShown,
    /** Opening symbol on doors: tip at the hinge edge (DIN) or at the handle edge. */
    hingeSymbol: "tip_at_hinge" as HingeSymbol,
    /** Front zone picked in a drawing (index into the front stack). */
    zone: null as number | null,
    ...(read(KEY_UI) ?? {}),
  });
  /** Tablet or phone width: the cabinet view is the default and carries the settings below the drawing. */
  narrow = $state(typeof matchMedia === "function" && matchMedia(NARROW).matches);

  constructor() {
    if (typeof matchMedia !== "function") return;
    matchMedia(NARROW).addEventListener("change", (e) => (this.narrow = e.matches));
  }

  /** The view mode in effect. */
  get viewMode(): ViewMode {
    return this.ui.viewMode ?? (this.narrow ? "cabinet" : "room");
  }

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

  // --- Persistence --------------------------------------------------------

  /** Loads the shop, preferences and project list; reopens the last project. */
  async boot(): Promise<void> {
    const db = await kv();
    // One-time migration of the single-project storage.
    let index = (await db.get<ProjectMeta[]>("index")) ?? [];
    const legacy = read(KEY_PROJECT);
    if (!index.length && legacy) {
      const id = newId();
      await db.set(`project:${id}`, legacy);
      index = [{ id, name: legacy.name ?? "Project", updated: Date.now(), cabinets: legacy.cabinets?.length ?? 0 }];
      await db.set("index", index);
      const legacyShop = read(KEY_SHOP);
      if (legacyShop) await db.set("shop", legacyShop);
      await db.set("last", id);
      try {
        localStorage.removeItem(KEY_PROJECT);
        localStorage.removeItem(KEY_SHOP);
      } catch {
        /* ignore */
      }
    }
    // First start: the example kitchen as a project to look at.
    if (!index.length) {
      const id = newId();
      await db.set(`project:${id}`, clone(exampleProject));
      index = [{ id, name: exampleProject.name, updated: Date.now(), cabinets: exampleProject.cabinets.length }];
      await db.set("index", index);
      await db.set("last", id);
    }
    this.shop = (await db.get<Doc>("shop")) ?? clone(exampleShop);
    const prefs = await db.get<Record<string, unknown>>("ui");
    if (prefs) Object.assign(this.ui, prefs);
    this.projects = index.sort((a, b) => b.updated - a.updated);
    const last = await db.get<string>("last");
    if (last && index.some((p) => p.id === last)) await this.openProject(last);
    this.ready = true;
  }

  /** Writes the open project, the shop and preferences (called on every change, debounced). */
  async persist(): Promise<void> {
    if (!this.ready) return;
    const db = await kv();
    await db.set("shop", $state.snapshot(this.shop));
    await db.set("ui", Object.fromEntries(PREFS.map((k) => [k, this.ui[k]])));
    if (!this.projectId) return;
    const doc = $state.snapshot(this.project);
    await db.set(`project:${this.projectId}`, doc);
    const meta: ProjectMeta = { id: this.projectId, name: doc.name ?? "", updated: Date.now(), cabinets: doc.cabinets?.length ?? 0 };
    this.projects = [meta, ...this.projects.filter((p) => p.id !== meta.id)];
    await db.set("index", $state.snapshot(this.projects));
  }

  async openProject(id: string): Promise<void> {
    const db = await kv();
    const doc = await db.get<Doc>(`project:${id}`);
    if (!doc) return;
    this.project = doc;
    this.projectId = id;
    this.history = [JSON.stringify(doc)];
    this.historyAt = 0;
    this.ui.selected = doc.cabinets?.[0]?.id ?? null;
    this.ui.part = null;
    this.screen = "project";
    await db.set("last", id);
  }

  /** Adds a project document to the list and opens it. */
  async addProject(doc: Doc): Promise<string> {
    const id = newId();
    const db = await kv();
    await db.set(`project:${id}`, doc);
    this.projects = [{ id, name: doc.name ?? "", updated: Date.now(), cabinets: doc.cabinets?.length ?? 0 }, ...this.projects];
    await db.set("index", $state.snapshot(this.projects));
    await this.openProject(id);
    return id;
  }

  async duplicateProject(id: string, suffix: string): Promise<void> {
    const doc = await (await kv()).get<Doc>(`project:${id}`);
    if (doc) await this.addProject({ ...doc, name: `${doc.name ?? ""} ${suffix}`.trim() });
  }

  async renameProject(id: string, name: string): Promise<void> {
    const db = await kv();
    const doc = id === this.projectId ? this.project : await db.get<Doc>(`project:${id}`);
    if (!doc) return;
    doc.name = name;
    if (id !== this.projectId) await db.set(`project:${id}`, doc);
    this.projects = this.projects.map((p) => (p.id === id ? { ...p, name } : p));
    await db.set("index", $state.snapshot(this.projects));
    if (id === this.projectId) await this.persist();
  }

  async deleteProject(id: string): Promise<void> {
    const db = await kv();
    await db.del(`project:${id}`);
    this.projects = this.projects.filter((p) => p.id !== id);
    await db.set("index", $state.snapshot(this.projects));
    if (id === this.projectId) {
      this.projectId = null;
      this.screen = "home";
      await db.del("last");
    }
  }

  async projectDoc(id: string): Promise<Doc | undefined> {
    return id === this.projectId ? $state.snapshot(this.project) : (await kv()).get<Doc>(`project:${id}`);
  }

  closeProject(): void {
    void this.persist();
    this.screen = "home";
  }

  resetShop(): void {
    this.shop = clone(exampleShop);
  }

  // --- Undo / redo ---------------------------------------------------------
  // Snapshots of the project document; edits in quick succession (typing)
  // are grouped by the caller's debounce.

  history: string[] = [];
  historyAt = 0;
  historyVersion = $state(0);
  private restoring = false;
  /** Set while a gesture (dragging a cabinet) changes the project in steps: it becomes one entry at its end. */
  historyHold = false;

  /** Records the current project state if it differs from the last snapshot. */
  record(): void {
    if (this.historyHold) return;
    if (this.restoring) {
      this.restoring = false;
      return;
    }
    const snap = JSON.stringify($state.snapshot(this.project));
    if (snap === this.history[this.historyAt]) return;
    this.history = [...this.history.slice(0, this.historyAt + 1), snap].slice(-100);
    this.historyAt = this.history.length - 1;
    this.historyVersion++;
  }

  get canUndo(): boolean {
    void this.historyVersion;
    return this.historyAt > 0;
  }
  get canRedo(): boolean {
    void this.historyVersion;
    return this.historyAt < this.history.length - 1;
  }

  undo(): void {
    if (!this.canUndo) return;
    this.historyAt--;
    this.restore();
  }
  redo(): void {
    if (!this.canRedo) return;
    this.historyAt++;
    this.restore();
  }
  private restore(): void {
    this.restoring = true;
    const doc = JSON.parse(this.history[this.historyAt]!);
    this.project = doc;
    if (this.ui.selected && !doc.cabinets?.some((c: Doc) => c.id === this.ui.selected)) this.ui.selected = doc.cabinets?.[0]?.id ?? null;
    this.historyVersion++;
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

/** Adds a cabinet from a template (factory or shop, D30/D33), named after it; it remembers the template. */
export function addFromTemplate(tpl: CabinetTemplate): void {
  const id = nextId(tpl.cabinet.kind);
  store.project.cabinets ??= [];
  store.project.cabinets.push({
    id,
    type: "box",
    name: localName(tpl.name, store.ui.lang),
    ...clone(tpl.cabinet),
    options: clone(tpl.cabinet.options ?? {}),
    template: tpl.id,
  });
  store.ui.selected = id;
  store.ui.part = null;
}

// ---------------------------------------------------------------------------
// Construction editor

let constructionSnapshot = "";
const cabinetJson = (): string => JSON.stringify($state.snapshot(store.cabinetDoc ?? {}));

export function openConstruction(): void {
  if (!store.cabinetDoc) return;
  constructionSnapshot = cabinetJson();
  store.ui.construction = store.ui.selected;
  store.ui.pane = "cabinet";
  // The construction is about the furniture itself: show it alone in 3D while the editor is open.
  viewBefore = { viewMode: store.ui.viewMode, cabinet3d: store.ui.cabinet3d };
  store.ui.viewMode = "cabinet";
  store.ui.cabinet3d = true;
}
let viewBefore: { viewMode: typeof store.ui.viewMode; cabinet3d: boolean } | undefined;
function restoreView(): void {
  if (viewBefore) Object.assign(store.ui, viewBefore);
  viewBefore = undefined;
}
export const constructionChanged = (): boolean => !!store.ui.construction && cabinetJson() !== constructionSnapshot;

/** Leaves the editor; the cabinet keeps its changes. */
export function closeConstruction(): void {
  store.ui.construction = null;
  restoreView();
}
export function discardConstruction(): void {
  const list = store.project.cabinets as Doc[];
  const i = list.findIndex((c) => c.id === store.ui.construction);
  if (i >= 0 && constructionSnapshot) list[i] = JSON.parse(constructionSnapshot);
  store.ui.construction = null;
  restoreView();
}

/** Template content of a cabinet: everything except id, name, place and template. */
export function templateBody(c: Doc): Doc {
  const { id: _i, type: _t, name: _n, place: _p, template: _tp, ...rest } = clone($state.snapshot(c));
  return { kind: "base", presets: [], vars: {}, options: {}, parts: {}, ...rest };
}

/**
 * Saves the cabinet in the editor as a shop template. With `id` of an
 * existing template it replaces it (a factory id gets a shop version that
 * takes its place); without, a new one is made. The cabinet then refers to it.
 */
export function saveCabinetTemplate(opts: { id?: string; name: string }): string {
  const c = store.cabinetDoc;
  if (!c) return "";
  store.shop.library ??= {};
  store.shop.library.templates ??= [];
  const list = store.shop.library.templates as Doc[];
  let id = opts.id;
  if (!id) {
    const base = opts.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "template";
    const used = new Set([...list.map((x) => x.id), ...FACTORY_TEMPLATES.map((x) => x.id)]);
    id = base;
    for (let k = 2; used.has(id); k++) id = `${base}-${k}`;
  }
  const tpl = { id, name: opts.name, group: "shop", cabinet: templateBody(c) };
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) list[i] = tpl;
  else list.push(tpl);
  c.template = id;
  constructionSnapshot = cabinetJson();
  return id;
}

/** Name of the template a cabinet refers to (shop version first). */
export function templateName(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const tpl = (store.shop.library?.templates as Doc[] | undefined)?.find((x) => x.id === id) ?? FACTORY_TEMPLATES.find((x) => x.id === id);
  return tpl ? localName(tpl.name, store.ui.lang) : undefined;
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

export type DownloadResult = SaveResult;

/** Saves a file through the platform (native dialog, save picker, host save or download). */
export function download(name: string, content: string | Uint8Array, type: string): Promise<DownloadResult> {
  return saveFile(name, content, type);
}

/** Status line for a download outcome. */
export function downloadNote(r: DownloadResult, file: string, t: (k: string, p?: Record<string, string>) => string): string {
  return r === "saved" ? t("ui.saved", { file }) : r === "cancelled" ? "" : r === "declined" ? t("ui.download_declined") : t("ui.download_blocked");
}

export const copy = copyText;

/** The bundled example kitchen, as a fresh document. */
export const exampleProjectDoc = (): Doc => clone(exampleProject);

/** Reads a project or shop file; throws with the engine's message when it is not valid. */
export function parseDocument(text: string): { kind: "project" | "shop"; doc: Doc } {
  const doc = JSON.parse(text) as Doc;
  if (doc.kind === "shop") {
    loadShop(doc);
    return { kind: "shop", doc };
  }
  loadProject(doc);
  return { kind: "project", doc };
}
