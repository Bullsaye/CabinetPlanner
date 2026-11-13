/**
 * Long press for touch and pen (the double-click of a finger, D73): calls
 * the handler when a pointer stays down in place. Mouse users double-click.
 * The click that follows the release is swallowed, so a long press is not
 * also a tap.
 */
export function longPress(node: Element, handler: (e: PointerEvent) => void): { update(h: (e: PointerEvent) => void): void; destroy(): void } {
  const HOLD_MS = 550;
  const SLOP = 8;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number; id: number } | undefined;
  let fired = false;
  const cancel = (): void => {
    clearTimeout(timer);
    timer = undefined;
    start = undefined;
  };
  const down = (ev: Event): void => {
    const e = ev as PointerEvent;
    fired = false;
    // A second finger is a pinch, not a press.
    if (e.pointerType === "mouse" || start) return cancel();
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    timer = setTimeout(() => {
      fired = true;
      cancel();
      handler(e);
    }, HOLD_MS);
  };
  const move = (ev: Event): void => {
    const e = ev as PointerEvent;
    if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) cancel();
  };
  const click = (ev: Event): void => {
    if (!fired) return;
    fired = false;
    ev.stopPropagation();
    ev.preventDefault();
  };
  const menu = (ev: Event): void => {
    // The browser's own long-press menu would cover the result.
    if (start || fired) ev.preventDefault();
  };
  node.addEventListener("pointerdown", down);
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerup", cancel);
  node.addEventListener("pointercancel", cancel);
  node.addEventListener("pointerleave", cancel);
  node.addEventListener("click", click, true);
  node.addEventListener("contextmenu", menu);
  return {
    update(h) {
      handler = h;
    },
    destroy() {
      cancel();
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", cancel);
      node.removeEventListener("pointercancel", cancel);
      node.removeEventListener("pointerleave", cancel);
      node.removeEventListener("click", click, true);
      node.removeEventListener("contextmenu", menu);
    },
  };
}
