import { describe, expect, test, vi } from "vitest";
import { currentDeclarations, declareSlot, onDeclarationsChange } from "./slots";

describe("slot registry", () => {
  test("mounted slots become declarations; unmount removes them", () => {
    const off = declareSlot("weather:home", "weather", { zip: "10001", title: "Home", onTap: () => {} });
    expect(currentDeclarations()).toEqual([{ id: "weather:home", module: "weather", props: { zip: "10001", title: "Home" }, visible: true }]);
    off();
    expect(currentDeclarations()).toEqual([]);
  });

  test("the same id twice is one declaration; first wins", () => {
    const a = declareSlot("stocks", "stocks", { symbols: "A" });
    const b = declareSlot("stocks", "stocks", { symbols: "B" });
    expect(currentDeclarations()).toEqual([{ id: "stocks", module: "stocks", props: { symbols: "A" }, visible: true }]);
    a(); b();
  });

  test("a slot is visible when any of its mounts is on a page being shown", () => {
    const a = declareSlot("system", "system", {}, false);
    expect(currentDeclarations()[0].visible).toBe(false);
    const b = declareSlot("system", "system", {}, true);
    expect(currentDeclarations()[0].visible).toBe(true);
    b();
    expect(currentDeclarations()[0].visible).toBe(false);
    a();
  });

  test("changes notify subscribers once per burst", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const unsub = onDeclarationsChange(fn);
    const a = declareSlot("clock", "clock", {});
    const b = declareSlot("clock:x", "clock", {});
    vi.advanceTimersByTime(60);
    expect(fn).toHaveBeenCalledTimes(1);
    a(); b(); unsub();
    vi.useRealTimers();
  });
});
