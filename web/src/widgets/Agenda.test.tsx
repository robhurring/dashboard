import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { WidgetTree } from "./WidgetTree";
import type { WidgetNode } from "../data/reduce";

const NOW = Date.UTC(2026, 9, 19, 20, 50, 0);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

const t = (mins: number) => NOW / 1000 + mins * 60;
const draw = (props: WidgetNode["props"]) => render(<WidgetTree node={{ type: "agenda", props, children: [] }} send={vi.fn()} />);

describe("ui.agenda", () => {
  test("the next event counts down large; the ones after are rows; finished ones are skipped", () => {
    draw({ events: [
      { title: "Retro", at: t(-60), end: t(-30) },
      { title: "Standup", at: t(10), end: t(25) },
      { title: "Planning", at: t(90), end: t(120) },
      { title: "1:1", at: t(180) },
    ], count: 3 });
    expect(screen.queryByText("Retro")).toBeNull();
    const next = screen.getByText("Standup").closest("[data-style]")!;
    expect(next).toHaveAttribute("data-style", "countdown");
    expect(next).toHaveTextContent("in 10m");
    expect(screen.getByText("Planning").closest("[data-style]")).toHaveAttribute("data-style", "event");
    expect(screen.getByText("1:1").closest("[data-style]")).toHaveAttribute("data-style", "event");
    expect(screen.getByText("Later")).toBeInTheDocument();
  });

  test("rolls on to the next event when one ends, by itself", () => {
    draw({ events: [{ title: "Standup", at: t(1), end: t(2) }, { title: "Planning", at: t(30) }] });
    expect(screen.getByText("Standup").closest("[data-style]")).toHaveAttribute("data-style", "countdown");
    act(() => { vi.advanceTimersByTime(3 * 60_000); });
    expect(screen.queryByText("Standup")).toBeNull();
    expect(screen.getByText("Planning").closest("[data-style]")).toHaveAttribute("data-style", "countdown");
  });

  test("count limits the rows; nothing left says so", () => {
    const { unmount } = draw({ events: [{ title: "A", at: t(5) }, { title: "B", at: t(6) }, { title: "C", at: t(7) }], count: 2 });
    expect(screen.queryByText("C")).toBeNull();
    unmount();
    draw({ events: [] });
    expect(screen.getByText("Nothing coming up")).toBeInTheDocument();
  });

  test("invites not answered yet: a New strip at the top, and marked in the timeline", () => {
    draw({ events: [
      { title: "Standup", at: t(10), end: t(25) },
      { title: "Planning", at: t(90), end: t(120), response: "pending" },
    ] });
    const strip = screen.getByRole("region", { name: "New · respond" });
    expect(strip).toHaveTextContent("Planning");
    const row = screen.getAllByText("Planning").map((el) => el.closest("[data-style=event]")).find((r) => r && !strip.contains(r))!;
    expect(row).toHaveTextContent("unanswered");
  });

  test("no strip when nothing is pending; the bell rings when a new invite arrives, not on first load", () => {
    const events = [{ title: "Standup", at: t(10) }];
    const { rerender } = render(<WidgetTree node={{ type: "agenda", props: { events }, children: [] }} send={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "New · respond" })).toBeNull();
    rerender(<WidgetTree node={{ type: "agenda", props: { events: [...events, { title: "Sync", at: t(60), response: "pending" }] }, children: [] }} send={vi.fn()} />);
    expect(screen.getByRole("region", { name: "New · respond" })).toHaveAttribute("data-ringing", "true");
  });
});
