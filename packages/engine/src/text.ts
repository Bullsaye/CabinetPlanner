import { z } from "zod";

/**
 * Library items are user data, so their names are plain text. Factory items
 * may carry a name per locale; `localName` picks one with English fallback.
 */
export const LocalizedText = z.union([z.string(), z.record(z.string(), z.string())]);
export type LocalizedText = z.infer<typeof LocalizedText>;

export function localName(text: LocalizedText, locale: string): string {
  if (typeof text === "string") return text;
  return text[locale] ?? text["en"] ?? Object.values(text)[0] ?? "";
}
