import { localName, OPTION_BY_KEY, type OptionDef } from "@cabinet-planner/engine";
import { store } from "./store.svelte.ts";

/** Choices of an option for a select: value is the JSON of the option value. */
export function optionChoices(o: OptionDef): { value: string; label: string }[] {
  const t = store.tr.t;
  const lib = store.result?.library;
  const k = o.kind;
  if (k.type === "enum") return k.values.map((v) => ({ value: JSON.stringify(v), label: t(`option.${o.key}.${v}`) }));
  if (k.type === "boolean") return [true, false].map((v) => ({ value: JSON.stringify(v), label: t(v ? "ui.yes" : "ui.no") }));
  if (k.type === "material")
    return [...(lib?.materials.values() ?? [])].map((m) => ({ value: JSON.stringify(m.id), label: localName(m.name, store.tr.locale) }));
  if (k.type === "edgeband")
    return [
      { value: "null", label: t("option.edge.none") },
      ...[...(lib?.edgebands.values() ?? [])].map((e) => ({ value: JSON.stringify(e.id), label: `${e.code} · ${localName(e.name, store.tr.locale)}` })),
    ];
  if (k.type === "surface")
    return [
      { value: "null", label: t("option.surface.none") },
      ...[...(lib?.surfaces.values() ?? [])].map((s) => ({ value: JSON.stringify(s.id), label: localName(s.name, store.tr.locale) })),
    ];
  const items = [...(lib?.hardware.values() ?? [])].filter((h) => h.category === k.category);
  return [...(k.nullable ? [{ value: "null", label: t("ui.none") }] : []), ...items.map((h) => ({ value: JSON.stringify(h.id), label: localName(h.name, store.tr.locale) }))];
}

export const optionDef = (key: string): OptionDef | undefined => OPTION_BY_KEY.get(key);
