import type { Library } from "../library.ts";
import { localName } from "../text.ts";
import type { DrawingText } from "./render.ts";

/** Anything that translates keys: the i18n Translator fits this shape. */
export interface TranslatorLike {
  locale: string;
  t(key: string, params?: Record<string, string | number>): string;
  number(x: number, maxDecimals?: number): string;
}

/** Text callbacks for drawings from a translator and the library. */
export function drawingText(tr: TranslatorLike, library: Library, styleName?: string): DrawingText {
  return {
    t: (k, p) => tr.t(k, p),
    locale: tr.locale,
    number: (x, d) => tr.number(x, d),
    hardwareName: (id) => {
      const h = library.hardware.get(id);
      return h ? localName(h.name, tr.locale) : undefined;
    },
    materialName: (id) => {
      const m = library.materials.get(id);
      return m ? localName(m.name, tr.locale) : undefined;
    },
    edgeCode: (id) => library.edgebands.get(id)?.code,
    roleName: (role) => tr.t(`role.${role}`),
    ...(styleName ? { styleName } : {}),
  };
}
