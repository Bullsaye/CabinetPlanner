import { describe, expect, it } from "vitest";
import { createTranslator, de, diagnosticText, en, interpolate, matchLocale } from "../src/index.ts";

describe("translator", () => {
  it("translates with placeholders", () => {
    const t = createTranslator("de").t;
    expect(t("role.bottom")).toBe("Boden");
    expect(t("diag.var_below_min", { name: "W", value: 50, min: 100 })).toBe("W ist 50, unter dem Minimum von 100.");
  });

  it("matches locale tags and falls back to English", () => {
    expect(matchLocale("de_AT.UTF-8")).toBe("de");
    expect(matchLocale("de-CH")).toBe("de");
    expect(matchLocale("fr-FR")).toBe("en");
    expect(matchLocale(undefined)).toBe("en");
    expect(createTranslator("fr").t("role.door")).toBe("Door");
  });

  it("returns the key for unknown messages", () => {
    expect(createTranslator("en").t("does.not.exist")).toBe("does.not.exist");
  });

  it("translates enumerated parameters of findings", () => {
    const tr = createTranslator("de");
    expect(diagnosticText(tr, "room_cabinet_in_opening", { kind: "window", wall: "A" })).toBe("Steht vor einer Öffnung (Fenster) an Wand A.");
    expect(diagnosticText(tr, "var_below_min", { name: "W", value: 50, min: 100 })).toBe("W ist 50, unter dem Minimum von 100.");
  });

  it("leaves unknown placeholders visible", () => {
    expect(interpolate("{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });

  it("formats display numbers per locale", () => {
    expect(createTranslator("de").number(529.5)).toBe("529,5");
    expect(createTranslator("en").number(529.5)).toBe("529.5");
    expect(createTranslator("de").number(1200)).toBe("1200");
  });

  it("German uses the same placeholders as English", () => {
    const names = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(names(de[key]), key).toEqual(names(en[key]));
    }
  });
});
