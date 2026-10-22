import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import type { CustomProps } from "@dashboard/components/registry";
import { Stats, gridFor } from "./index";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_300 * 1000)); });
afterEach(() => vi.useRealTimers());

const props = (state: unknown, config: Record<string, unknown> = {}): CustomProps => ({ state: state as never, config: config as never, status: null, send: vi.fn(), title: "Stats", density: "normal" });

describe("Stats panel", () => {
  test("one tile per label, with the number, tone, icon and line; the push time is the panel header's", () => {
    render(<Stats {...props({ pushed_at: 1_800_000_000, items: [
      { label: "Urgent", number: 1, tone: "bad", icon: "bell", sub: "#incident" },
      { label: "Unread", number: 12 },
    ] })} />);
    const tiles = screen.getAllByRole("listitem");
    expect(tiles).toHaveLength(2);
    expect(within(tiles[0]).getByText("1").closest(".tabular-nums")).toHaveClass("text-bad");
    expect(within(tiles[0]).getByText("#incident")).toBeInTheDocument();
    expect(tiles[0].querySelector('[data-icon="bell"]')).not.toBeNull();
    expect(within(tiles[1]).getByText("12")).toBeInTheDocument();
    expect(screen.queryByText(/updated/)).toBeNull();
  });

  test("a number that goes up pops; an urgent one rings its bell; nothing moves on first load or on a drop", () => {
    const at = (items: unknown[]) => props({ pushed_at: 1_800_000_000, items });
    const { rerender } = render(<Stats {...at([
      { label: "Urgent", number: 1, tone: "bad", icon: "bell" },
      { label: "Unread", number: 12 },
      { label: "DMs", number: 4, icon: "message-square", ring: true },
    ])} />);
    const tile = (label: string) => screen.getByText(label).closest("li")!;
    expect(tile("Urgent")).toHaveAttribute("data-motion", "none"); // first load: no history to compare
    rerender(<Stats {...at([
      { label: "Urgent", number: 2, tone: "bad", icon: "bell" },
      { label: "Unread", number: 15 },
      { label: "DMs", number: 3, icon: "message-square", ring: true },
    ])} />);
    expect(tile("Urgent")).toHaveAttribute("data-motion", "ring");
    expect(tile("Unread")).toHaveAttribute("data-motion", "pop");
    expect(tile("DMs")).toHaveAttribute("data-motion", "none"); // went down
    act(() => { vi.advanceTimersByTime(2500); });
    expect(tile("Urgent")).toHaveAttribute("data-motion", "none");
    rerender(<Stats {...at([
      { label: "Urgent", number: 2, tone: "bad", icon: "bell" },
      { label: "Unread", number: 15 },
      { label: "DMs", number: 5, icon: "message-square", ring: true },
    ])} />);
    expect(tile("DMs")).toHaveAttribute("data-motion", "ring"); // ring: true forces the bell
    expect(tile("Urgent")).toHaveAttribute("data-motion", "none"); // unchanged
  });

  test("the same label from two sources is two tiles, with no source caption squeezing the label", () => {
    render(<Stats {...props({ pushed_at: 1_800_000_000, items: [
      { source: "email", label: "Unread", number: 4, icon: "mail" },
      { source: "slack", label: "Unread", number: 12, icon: "inbox" },
    ] })} />);
    const tiles = screen.getAllByRole("listitem");
    expect(tiles).toHaveLength(2);
    expect(screen.queryByText("email")).toBeNull();
    expect(screen.queryByText("slack")).toBeNull();
  });

  test("before the first push it says it is waiting", () => {
    render(<Stats {...props(null)} />);
    expect(screen.getByText("Waiting for the first push")).toBeInTheDocument();
  });

  test("the grid fills the panel: columns and rows chosen from the count and the panel's shape", () => {
    // The Work panel: half the screen wide, nearly full height.
    expect(gridFor(6, 600, 640)).toEqual({ cols: 2, rows: 3 });
    expect(gridFor(9, 600, 640)).toEqual({ cols: 3, rows: 3 });
    expect(gridFor(4, 600, 640)).toEqual({ cols: 2, rows: 2 });
    expect(gridFor(1, 600, 640)).toEqual({ cols: 1, rows: 1 });
    expect(gridFor(5, 600, 640)).toEqual({ cols: 2, rows: 3 });
    // A wide, short panel lays the same six out in rows.
    expect(gridFor(6, 1200, 400)).toEqual({ cols: 3, rows: 2 });
    expect(gridFor(0, 600, 640)).toEqual({ cols: 1, rows: 1 });
    // Before the panel has been measured: a square-ish grid, never one column of slivers.
    expect(gridFor(12, 0, 0)).toEqual({ cols: 4, rows: 3 });
    expect(gridFor(5, 0, 0)).toEqual({ cols: 3, rows: 2 });
  });

  test("layout: fill (the default) stretches a grid over the panel; flow keeps fixed tiles that wrap", () => {
    const items = [{ label: "A", number: 1 }, { label: "B", number: 2 }];
    const { container, unmount } = render(<Stats {...props({ pushed_at: 1_800_000_000, items })} />);
    expect(container.querySelector("ul")).toHaveAttribute("data-layout", "fill");
    unmount();
    const flow = render(<Stats {...props({ pushed_at: 1_800_000_000, items }, { layout: "flow" })} />);
    expect(flow.container.querySelector("ul")).toHaveAttribute("data-layout", "flow");
  });

  test("stats arriving after the waiting message still get a full grid", () => {
    const { rerender, container } = render(<Stats {...props(null)} />);
    const items = Array.from({ length: 12 }, (_, i) => ({ label: `S${i}`, number: i }));
    rerender(<Stats {...props({ pushed_at: 1_800_000_000, items })} />);
    const ul = container.querySelector("ul")!;
    expect(Number(ul.dataset.cols) * Number(ul.dataset.rows)).toBeGreaterThanOrEqual(12);
  });

  test("the last tile stretches over the empty cells of the last row", () => {
    const items = Array.from({ length: 3 }, (_, i) => ({ label: `S${i}`, number: i }));
    render(<Stats {...props({ pushed_at: 1_800_000_000, items })} />);
    const tiles = screen.getAllByRole("listitem");
    expect(tiles[2].style.gridColumn).toBe("span 2"); // 2 x 2 with one empty cell
    expect(tiles[0].style.gridColumn).toBe("");
  });

  test("align: left (default) or center", () => {
    const items = [{ label: "A", number: 1 }];
    const { container, unmount } = render(<Stats {...props({ pushed_at: 1_800_000_000, items })} />);
    expect(container.querySelector("ul")).toHaveAttribute("data-align", "left");
    unmount();
    const centered = render(<Stats {...props({ pushed_at: 1_800_000_000, items }, { align: "center" })} />);
    expect(centered.container.querySelector("ul")).toHaveAttribute("data-align", "center");
  });
});
