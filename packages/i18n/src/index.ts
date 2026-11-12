import { de } from "./locales/de.ts";
import { en, type MessageKey } from "./locales/en.ts";

export { en, de, type MessageKey };

export type Params = Readonly<Record<string, string | number>>;

/**
 * Catalogues by locale. To add a language, add a file in `locales/` typed as
 * `Partial<Record<MessageKey, string>>` (missing keys fall back to English)
 * and register it here. German is typed complete on purpose.
 */
const CATALOGS: Readonly<Record<string, Partial<Record<MessageKey, string>>>> = { en, de };

export const LOCALES = Object.keys(CATALOGS);
export const DEFAULT_LOCALE = "en";

export interface Translator {
  readonly locale: string;
  /**
   * Translates a key. Accepts plain strings because many keys are built at
   * runtime (`diag.${code}`); unknown keys return the key itself so a gap is
   * visible instead of blank.
   */
  t(key: MessageKey | (string & {}), params?: Params): string;
  has(key: string): boolean;
  /** Locale-aware number for display (never for machine outputs). */
  number(x: number, maxDecimals?: number): string;
}

/** Picks the best supported locale for a tag like "de-AT" or "en_GB". */
export function matchLocale(tag: string | undefined): string {
  if (!tag) return DEFAULT_LOCALE;
  const base = tag.toLowerCase().replace("_", "-").split("-")[0]!;
  return Object.hasOwn(CATALOGS, base) ? base : DEFAULT_LOCALE;
}

export function createTranslator(locale: string): Translator {
  const loc = matchLocale(locale);
  const catalog = CATALOGS[loc]!;
  const lookup = (key: string): string | undefined =>
    (Object.hasOwn(catalog, key) ? catalog[key as MessageKey] : undefined) ??
    (Object.hasOwn(en, key) ? en[key as MessageKey] : undefined);
  const nf = new Map<number, Intl.NumberFormat>();

  return {
    locale: loc,
    t(key, params) {
      const msg = lookup(key);
      if (msg === undefined) return key;
      return params ? interpolate(msg, params) : msg;
    },
    has: (key) => lookup(key) !== undefined,
    number(x, maxDecimals = 2) {
      let f = nf.get(maxDecimals);
      if (!f) {
        f = new Intl.NumberFormat(loc, { maximumFractionDigits: maxDecimals, useGrouping: false });
        nf.set(maxDecimals, f);
      }
      return f.format(x);
    },
  };
}

/** Parameters of a finding that are enumerated values with a translation: message key prefix by parameter. */
const DIAGNOSTIC_PARAM_KEYS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  room_cabinet_in_opening: { kind: "ui.opening." },
  worktop_cutout_outside: { kind: "option.worktop_cutout." },
  option_unknown: { layer: "ui.layer." },
  preset_unknown: { layer: "ui.layer." },
};

/** Text of a diagnostic (`diag.<code>`); parameters that are enumerated values are translated too. */
export function diagnosticText(tr: Translator, code: string, params: Params): string {
  const keys = DIAGNOSTIC_PARAM_KEYS[code];
  if (!keys) return tr.t(`diag.${code}`, params);
  const shown: Record<string, string | number> = { ...params };
  for (const [name, prefix] of Object.entries(keys)) {
    const key = `${prefix}${String(params[name])}`;
    if (tr.has(key)) shown[name] = tr.t(key);
  }
  return tr.t(`diag.${code}`, shown);
}

/** Replaces `{name}` placeholders; unknown placeholders are left as they are. */
export function interpolate(msg: string, params: Params): string {
  return msg.replace(/\{([A-Za-z0-9_]+)\}/g, (m, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : m,
  );
}
