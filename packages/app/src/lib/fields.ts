import { localName, OPTION_BY_KEY, VARIABLE_BY_NAME, type OptionDef } from "@cabinet-planner/engine";
import { setVar, store, type Layer } from "./store.svelte.ts";

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

/** Touch steppers: the resolved value plus or minus the variable's step, within its limits. */
export function stepVar(layer: Layer, name: string, by: number, current: number | undefined): void {
  const def = VARIABLE_BY_NAME.get(name);
  let next = (current ?? 0) + by;
  if (def?.min !== undefined) next = Math.max(def.min, next);
  if (def?.max !== undefined) next = Math.min(def.max, next);
  setVar(layer, name, Math.round(next * 100) / 100);
}

export const optionDef = (key: string): OptionDef | undefined => OPTION_BY_KEY.get(key);
