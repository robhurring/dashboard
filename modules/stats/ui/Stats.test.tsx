import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import type { CustomProps } from "@dashboard/components/registry";
import { Stats } from "./index";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_300 * 1000)); });
afterEach(() => vi.useRealTimers());

const props = (state: unknown): CustomProps => ({ state: state as never, config: {}, status: null, send: vi.fn(), title: "Stats", density: "normal" });

describe("Stats panel", () => {
  test("one tile per label, with the number, tone, icon and line; and how old the push is", () => {
    render(<Stats {...props({ pushed_at: 1_800_000_000, items: [
      { label: "Urgent", number: 1, tone: "bad", icon: "bell", sub: "#incident" },
      { label: "Unread", number: 12 },
    ] })} />);
    const tiles = screen.getAllByRole("listitem");
    expect(tiles).toHaveLength(2);
    expect(within(tiles[0]).getByText("1").closest(".type-value")).toHaveClass("text-bad");
    expect(within(tiles[0]).getByText("#incident")).toBeInTheDocument();
    expect(tiles[0].querySelector('[data-icon="bell"]')).not.toBeNull();
    expect(within(tiles[1]).getByText("12")).toBeInTheDocument();
    expect(screen.getByText("updated 5m ago")).toBeInTheDocument();
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

  test("the same label from two sources is two tiles, each captioned with its source", () => {
    render(<Stats {...props({ pushed_at: 1_800_000_000, items: [
      { source: "email", label: "Unread", number: 4 },
      { source: "slack", label: "Unread", number: 12 },
    ] })} />);
    const tiles = screen.getAllByRole("listitem");
    expect(tiles).toHaveLength(2);
    expect(within(tiles[0]).getByText("email")).toBeInTheDocument();
    expect(within(tiles[1]).getByText("slack")).toBeInTheDocument();
  });

  test("with a single source, no caption", () => {
    render(<Stats {...props({ pushed_at: 1_800_000_000, items: [{ source: "slack", label: "Unread", number: 1 }, { source: "slack", label: "DMs", number: 2 }] })} />);
    expect(screen.queryByText("slack")).toBeNull();
  });

  test("before the first push it says it is waiting", () => {
    render(<Stats {...props(null)} />);
    expect(screen.getByText("Waiting for the first push")).toBeInTheDocument();
  });
});
