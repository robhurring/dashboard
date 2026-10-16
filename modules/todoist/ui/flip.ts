import { useLayoutEffect, useRef, type RefObject } from "react";

/*
 * FLIP layout animation: when the children of `container` (elements carrying `data-flip-id`)
 * change position between renders, each one glides from where it was to where it is now instead
 * of jumping. Transform-only, so it stays on the compositor. Skips the element being dragged.
 */
export function useFlip(container: RefObject<HTMLElement | null>, deps: unknown[], { duration = 300, easing = "cubic-bezier(0.2, 0, 0, 1)" } = {}) {
  const last = useRef<Map<string, DOMRect>>(new Map());

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const next = new Map<string, DOMRect>();
    for (const el of root.querySelectorAll<HTMLElement>("[data-flip-id]")) {
      const id = el.dataset.flipId!;
      const rect = el.getBoundingClientRect();
      next.set(id, rect);
      const prev = last.current.get(id);
      if (!prev || typeof el.animate !== "function" || el.dataset.flipSkip === "true") continue;
      const dx = prev.left - rect.left;
      const dy = prev.top - rect.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration, easing });
    }
    last.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
