import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { WidgetTree } from "./WidgetTree";
import type { WidgetNode } from "../protocol/WidgetNode";
import { countdownTone, relativeText, timerText } from "./Countdown";

const NOW = Date.UTC(2026, 9, 19, 20, 50, 0); // 4:50 pm in New York
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

const node = (props: WidgetNode["props"]): WidgetNode => ({ type: "countdown", props, children: [] });
const draw = (props: WidgetNode["props"]) => render(<WidgetTree node={node(props)} send={vi.fn()} />);
const min = 60_000;

describe("countdown text", () => {
  test("relative: whole minutes and hours, seconds under a minute or when asked", () => {
    expect(relativeText(10 * min, { seconds: false })).toBe("in 10m");
    expect(relativeText(65 * min, { seconds: false })).toBe("in 1h 5m");
    expect(relativeText(26 * 60 * min, { seconds: false })).toBe("in 1d 2h");
    expect(relativeText(45_000, { seconds: false })).toBe("in 45s");
    expect(relativeText(9 * min + 30_000, { seconds: true })).toBe("in 9m 30s");
    expect(relativeText(9 * min + 30_000, { seconds: false })).toBe("in 10m"); // rounds up: never says 9m while 9:30 remain
  });

  test("timer: m:ss, or h:mm:ss over an hour", () => {
    expect(timerText(9 * min + 5_000)).toBe("9:05");
    expect(timerText(65 * min)).toBe("1:05:00");
    expect(timerText(-5_000)).toBe("0:00");
  });

  test("tone: plain, then warn inside warn_at minutes, bad inside bad_at, accent once it's on", () => {
    expect(countdownTone(30 * min, 10, 2)).toBeUndefined();
    expect(countdownTone(9 * min, 10, 2)).toBe("warn");
    expect(countdownTone(90_000, 10, 2)).toBe("bad");
    expect(countdownTone(-1, 10, 2)).toBe("accent");
  });
});

describe("ui.countdown", () => {
  test("counts down to `at` and shows when it is; ticks on its own", () => {
    draw({ at: "2026-10-19T17:00:00-04:00", label: "Standup", tz: "America/New_York" });
    expect(screen.getByText("Standup")).toBeInTheDocument();
    expect(screen.getByText("in 10m")).toBeInTheDocument();
    expect(screen.getByText("5:00 pm")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(9 * min + 30_000); });
    expect(screen.getByText("in 30s")).toBeInTheDocument();
  });

  test("takes unix seconds too; during it says now and how long is left, then ended", () => {
    const at = NOW / 1000 - 5 * 60;
    draw({ at, end: at + 30 * 60, label: "1:1" });
    expect(screen.getByText("now · 25m left")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(26 * min); });
    expect(screen.getByText("ended")).toBeInTheDocument();
  });

  test("without an end: started, and how long ago", () => {
    draw({ at: NOW / 1000 - 3 * 60, label: "Deploy" });
    expect(screen.getByText("started 3m ago")).toBeInTheDocument();
  });

  test("timer style", () => {
    draw({ at: NOW / 1000 + 9 * 60 + 5, style: "timer" });
    expect(screen.getByText("9:05")).toBeInTheDocument();
  });

  test("event style: a calendar-like row with the time range, the title and how soon", () => {
    draw({ at: "2026-10-19T17:00:00-04:00", end: "2026-10-19T17:30:00-04:00", label: "Planning", style: "event", tz: "America/New_York" });
    const row = screen.getByText("Planning").closest("[data-style=event]")!;
    expect(row).toHaveTextContent("5:00 pm – 5:30 pm");
    expect(row).toHaveTextContent("in 10m");
  });

  test("time = false hides the clock time; a bad `at` says so", () => {
    const { unmount } = draw({ at: NOW / 1000 + 600, label: "x", time: false });
    expect(screen.queryByText(/pm$/)).toBeNull();
    unmount();
    draw({ at: "not a time", label: "y" });
    expect(screen.getByText("no time")).toBeInTheDocument();
  });
});
