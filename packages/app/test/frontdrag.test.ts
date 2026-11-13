import { describe, expect, it } from "vitest";
import { DRAG_MIN_H, dropSlot, edgeHeight, moveItem, setBoundary, type HeightZone } from "../src/lib/frontdrag.ts";

describe("reordering fronts", () => {
  // Middles of four fronts, top to bottom (pointer positions grow downwards).
  const mids = [100, 300, 500, 700];
  it("finds the slot a dragged front would take", () => {
    expect(dropSlot(0, 50, mids)).toBe(0);
    expect(dropSlot(0, 350, mids)).toBe(1);
    expect(dropSlot(0, 800, mids)).toBe(3);
    expect(dropSlot(3, 50, mids)).toBe(0);
    expect(dropSlot(2, 400, mids)).toBe(2);
    expect(dropSlot(2, 250, mids)).toBe(1);
    expect(dropSlot(1, 250, mids)).toBe(1);
  });
  it("moves an item within the list", () => {
    const l = ["a", "b", "c", "d"];
    expect(moveItem(l, 0, 2)).toBe(true);
    expect(l).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(l, 3, 0)).toBe(true);
    expect(l).toEqual(["d", "b", "c", "a"]);
    expect(moveItem(l, 1, 1)).toBe(false);
    expect(moveItem(l, 9, 0)).toBe(false);
    // A slot past the end is the end.
    expect(moveItem(l, 0, 9)).toBe(true);
    expect(l).toEqual(["b", "c", "a", "d"]);
  });
  it("drop slot and move together put the front where it was dropped", () => {
    const l = ["top", "mid", "low"];
    const at = dropSlot(0, 800, [100, 300, 500]);
    moveItem(l, 0, at);
    expect(l).toEqual(["mid", "low", "top"]);
  });
});

describe("dragging the line between two fronts", () => {
  it("keeps the sum, the grid and the smallest height", () => {
    expect(edgeHeight(300, 400, 12.4, 1)).toBe(312);
    expect(edgeHeight(300, 400, -12.6, 1)).toBe(287);
    expect(edgeHeight(300, 400, 12.4, 5)).toBe(310);
    expect(edgeHeight(300, 400, 1000, 1)).toBe(700 - DRAG_MIN_H);
    expect(edgeHeight(300, 400, -1000, 1)).toBe(DRAG_MIN_H);
    // Two fronts lower than twice the limit: they meet in the middle at most.
    expect(edgeHeight(20, 20, 50, 1)).toBe(20);
  });

  it("gives heights to fixed fronts, leaves the only rest front as rest", () => {
    const fixed: HeightZone[] = [{ h: 150 }, { h: 150 }, {}];
    setBoundary(fixed, 0, 170, 130);
    expect(fixed).toEqual([{ h: 170 }, { h: 130 }, {}]);
    // The lower front is the only rest one: it takes up the difference by itself.
    const lowRest: HeightZone[] = [{ h: 150 }, {}];
    setBoundary(lowRest, 0, 200, 400);
    expect(lowRest).toEqual([{ h: 200 }, {}]);
    const upRest: HeightZone[] = [{}, { h: 150 }];
    setBoundary(upRest, 0, 400, 200);
    expect(upRest).toEqual([{}, { h: 200 }]);
  });

  it("fixes a rest front when another rest front would share the difference", () => {
    const two: HeightZone[] = [{}, {}];
    setBoundary(two, 0, 300, 400);
    expect(two).toEqual([{ h: 300 }, {}]);
    const three: HeightZone[] = [{}, {}, {}];
    setBoundary(three, 0, 300, 400);
    expect(three).toEqual([{ h: 300 }, { h: 400 }, {}]);
    const upRestOther: HeightZone[] = [{}, { h: 150 }, {}];
    setBoundary(upRestOther, 0, 300, 200);
    expect(upRestOther).toEqual([{ h: 300 }, { h: 200 }, {}]);
    // Formulas give way to the dragged number.
    const formula: HeightZone[] = [{ h: "H / 3" }, { h: 150 }, {}];
    setBoundary(formula, 0, 250, 140);
    expect(formula).toEqual([{ h: 250 }, { h: 140 }, {}]);
    // Out of range: nothing happens.
    setBoundary(formula, 2, 1, 1);
    expect(formula).toEqual([{ h: 250 }, { h: 140 }, {}]);
  });
});
