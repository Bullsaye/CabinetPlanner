import type { LocalizedText } from "./text.ts";

type TemplateFront = { type: "door" | "drawer" | "open" | "appliance" | "panel" | "flap"; h?: number | string; doors?: number; hinge?: "left" | "right"; front?: boolean; shelves?: number; handle?: string | null };
type TemplateConstruction = {
  panels?: { y: number | string; setbackFront?: number | string; setbackRear?: number | string }[];
  fixed?: Record<string, { panel?: boolean; setbackFront?: number | string; setbackRear?: number | string }>;
  noBack?: number[];
};

/**
 * A cabinet template as written in a pack or library file (D30, D76): a
 * starting point the app offers in its "add cabinet" menu. A template is
 * plain cabinet input without an id; all sizes are variables or expressions
 * over shop variables, so a template follows the shop's standard sizes.
 * The templates themselves live in the packs (`packs/*-templates`).
 */
export interface CabinetTemplate {
  id: string;
  name: LocalizedText;
  group?: string;
  cabinet: {
    kind: "base" | "wall" | "tall";
    presets: string[];
    vars: Record<string, number | string>;
    options?: Record<string, string | boolean | null>;
    fronts?: TemplateFront[];
    construction?: {
      panels?: { y: number | string; setbackFront?: number | string; setbackRear?: number | string }[];
      fixed?: Record<string, { panel?: boolean; setbackFront?: number | string; setbackRear?: number | string }>;
      noBack?: number[];
      parts?: Record<string, unknown>[];
      omit?: string[];
      bores?: Record<string, unknown>[];
      hardware?: { item: string; qty?: number | string }[];
    };
    params?: { name: string; label?: LocalizedText; default?: number | string; min?: number; max?: number; step?: number; integer?: boolean; unit?: "mm" | "count" }[];
    sections?: { w?: number | string; fronts?: TemplateFront[]; interior?: "shelves" | "hanging"; shelves?: number | string; construction?: TemplateConstruction; holes?: false | { from?: number | string; to?: number | string } }[];
  };
}
