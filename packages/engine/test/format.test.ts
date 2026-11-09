import { describe, expect, it } from "vitest";
import { csvField, formatNumber, toCsv } from "../src/index.ts";

describe("output formatting", () => {
  it("formats numbers with a dot and no trailing zeros", () => {
    expect(formatNumber(720)).toBe("720");
    expect(formatNumber(529.5)).toBe("529.5");
    expect(formatNumber(1 / 3)).toBe("0.33");
    expect(formatNumber(-0.001)).toBe("0");
    expect(formatNumber(10)).toBe("10");
    expect(formatNumber(100.10)).toBe("100.1");
  });

  it("quotes CSV fields only when needed", () => {
    expect(csvField("plain", ",")).toBe("plain");
    expect(csvField("a,b", ",")).toBe('"a,b"');
    expect(csvField("a,b", ";")).toBe("a,b");
    expect(csvField('say "hi"', ",")).toBe('"say ""hi"""');
    expect(toCsv([["a", "b"], ["1", "2"]])).toBe("a,b\n1,2\n");
  });
});
