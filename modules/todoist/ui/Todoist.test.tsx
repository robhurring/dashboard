import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { CustomProps } from "@dashboard/components/registry";
import { TodoistBoard, TodoistList, applyPendingMoves, formatDue, useTasks } from "./index";
import { renderHook } from "@testing-library/react";

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id, content: `Task ${id}`, description: "", due: null, priority: 1, project_name: null, labels: [] as string[],
  days_overdue: null, overdue: false, section_id: null, added_at: "2026-10-01T00:00:00Z", updated_at: null, is_recurring: false, ...over,
});
const state = {
  total: 3,
  project_id: "p",
  synced_at: 1,
  columns: [
    { key: "backlog", label: "Backlog", items: [item("t1", { project_name: "Errands", overdue: true, days_overdue: 3, due: "2026-10-12", description: "Buy [milk](https://x) and **eggs**" }), item("t3", { labels: ["work"] })] },
    { key: "Doing", label: "Doing", section_id: "s1", items: [item("t2", { priority: 4 })] },
    { key: "Done", label: "Done", section_id: "s2", items: [] },
  ],
};
/** The front face's slot; the back face can carry the same title while a turn is in progress. */
const slotOf = (title: string) => screen.getAllByText(title)[0].closest("li")!;

const props = (send = vi.fn().mockResolvedValue(undefined)): CustomProps => ({ state: state as unknown as CustomProps["state"], config: { project: "Board" }, status: null, send, title: "Tasks", density: "normal" });

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe("TodoistBoard", () => {
  test("renders a column per section with counts, cards and the backlog project tag", () => {
    render(<TodoistBoard {...props()} />);
    const backlog = screen.getByRole("region", { name: "Backlog" });
    expect(within(backlog).getByText("2")).toBeInTheDocument();
    expect(within(backlog).getByText("Task t1")).toBeInTheDocument();
    expect(within(backlog).getAllByText("Errands").some((e) => e.classList.contains("note-tag"))).toBe(true);
    expect(within(screen.getByRole("region", { name: "Doing" })).getByText("Task t2")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Done" })).getByText("Nothing here")).toBeInTheDocument();
  });

  test("markdown links render as plain text, never anchors", () => {
    render(<TodoistBoard {...props()} />);
    expect(screen.getByText("milk")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("eggs").tagName).toBe("STRONG");
  });

  test("a tap expands the card; Done completes the task and undo reopens it", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    render(<TodoistBoard {...props(send)} />);
    const card = slotOf("Task t1");
    expect(card.querySelector(".note")).not.toHaveClass("note--open");
    fireEvent.pointerDown(card, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(card, { clientX: 10, clientY: 10 });
    const details = await screen.findByRole("group", { name: "Task t1 details" });
    expect(card.querySelector(".note")).toHaveClass("note--open");
    expect(within(details).getByText("Priority")).toBeInTheDocument();
    expect(within(details).getByText("Errands")).toBeInTheDocument();
    fireEvent.click(within(details).getByRole("button", { name: /done/i }));
    expect(send).toHaveBeenCalledWith("complete", { id: "t1" });
    // The note plays a short exit before it goes.
    expect(slotOf("Task t1")).toHaveClass("note-slot--leaving");
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByText("Task t1")).toBeNull();
    const toast = screen.getByRole("status", { name: "Task completed" });
    fireEvent.click(within(toast).getByRole("button", { name: /undo/i }));
    expect(send).toHaveBeenCalledWith("reopen", { id: "t1" });
    expect(slotOf("Task t1")).toBeInTheDocument();
  });

  test("tapping an open card closes it; opening another closes the first", async () => {
    render(<TodoistBoard {...props()} />);
    const card = slotOf("Task t2");
    fireEvent.pointerDown(card, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(card, { clientX: 10, clientY: 10 });
    await screen.findByRole("group", { name: "Task t2 details" });
    fireEvent.pointerDown(card, { clientX: 12, clientY: 12 });
    fireEvent.pointerUp(card, { clientX: 12, clientY: 12 });
    expect(screen.queryByRole("group", { name: "Task t2 details" })).toBeNull();
    fireEvent.pointerDown(card, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(card, { clientX: 10, clientY: 10 });
    await screen.findByRole("group", { name: "Task t2 details" });
    const other = slotOf("Task t3");
    fireEvent.pointerDown(other, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(other, { clientX: 10, clientY: 10 });
    await screen.findByRole("group", { name: "Task t3 details" });
    expect(screen.queryByRole("group", { name: "Task t2 details" })).toBeNull();
  });

  test("the details block is always in the card, collapsed until opened; title, description and footer never change", async () => {
    render(<TodoistBoard {...props()} />);
    const card = slotOf("Task t1");
    const details = card.querySelector(".note-details")!;
    expect(details).toHaveAttribute("aria-hidden", "true");
    expect(details).toHaveAttribute("data-open", "false");
    const before = [card.querySelector(".note-head")!.outerHTML, card.querySelector(".note-desc")!.outerHTML, card.querySelector(".note-foot")!.outerHTML];
    fireEvent.pointerDown(card, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(card, { clientX: 10, clientY: 10 });
    await screen.findByRole("group", { name: "Task t1 details" });
    expect(details).toHaveAttribute("data-open", "true");
    expect(details).not.toHaveAttribute("aria-hidden", "true");
    expect([card.querySelector(".note-head")!.outerHTML, card.querySelector(".note-desc")!.outerHTML, card.querySelector(".note-foot")!.outerHTML]).toEqual(before);
  });

  test("a failed complete puts the card back with a message", async () => {
    const send = vi.fn().mockRejectedValue(new Error("todoist said no"));
    render(<TodoistBoard {...props(send)} />);
    const card = slotOf("Task t3");
    fireEvent.pointerDown(card, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(card, { clientX: 10, clientY: 10 });
    const details = await screen.findByRole("group", { name: "Task t3 details" });
    await act(async () => { fireEvent.click(within(details).getByRole("button", { name: /done/i })); });
    expect(await screen.findByText(/could not complete/i)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(500); });
    expect(slotOf("Task t3")).not.toHaveClass("note-slot--leaving");
  });
});

describe("TodoistList", () => {
  test("lists every card under its section heading", () => {
    render(<TodoistList {...props()} />);
    expect(screen.getByRole("heading", { name: /^Backlog/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Doing/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Done/ })).toBeNull(); // empty sections are skipped
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("moves", () => {
  const doing = state.columns[1];

  test("a move shows in the new column at once and stays there until the snapshot confirms it", async () => {
    let resolve!: () => void;
    const send = vi.fn().mockReturnValue(new Promise<void>((r) => { resolve = r; }));
    const { result, rerender } = renderHook(({ s }) => useTasks(s as never, send), { initialProps: { s: state } });
    act(() => { result.current.move(state.columns[0].items[1], "Doing", "s1"); });
    expect(send).toHaveBeenCalledWith("move", { id: "t3", section_id: "s1" });
    expect(result.current.columns[1].items.map((i) => i.id)).toEqual(["t2", "t3"]);
    // The ack arrives before the refetched snapshot: the card must not flash back.
    await act(async () => { resolve(); });
    expect(result.current.columns[1].items.map((i) => i.id)).toEqual(["t2", "t3"]);
    // The snapshot now has it in Doing: the optimistic copy retires.
    const confirmed = { ...state, columns: [{ ...state.columns[0], items: [state.columns[0].items[0]] }, { ...doing, items: [...doing.items, { ...state.columns[0].items[1], section_id: "s1" }] }, state.columns[2]] };
    rerender({ s: confirmed as typeof state });
    expect(result.current.columns[1].items.map((i) => i.id)).toEqual(["t2", "t3"]);
    expect(result.current.notice).toBeNull();
  });

  test("a rejected move puts the card back and says why", async () => {
    const send = vi.fn().mockRejectedValue(new Error("section not found"));
    render(<TodoistBoard {...props(send)} />);
    const { result } = renderHook(() => useTasks(state as never, send));
    await act(async () => { result.current.move(state.columns[0].items[1], "Doing", "s1"); });
    expect(result.current.columns[0].items.map((i) => i.id)).toEqual(["t1", "t3"]);
    expect(result.current.notice).toEqual({ kind: "move-failed", item: state.columns[0].items[1], toLabel: "Doing", error: "section not found" });
  });
});

describe("helpers", () => {
  test("pending moves land a card in its new column at the server's sort position", () => {
    // t1 is overdue, so it sorts ahead of t2 (P1) in Doing.
    const moved = applyPendingMoves(state.columns, { t1: { item: state.columns[0].items[0], toKey: "Doing" } });
    expect(moved[0].items.map((i) => i.id)).toEqual(["t3"]);
    expect(moved[1].items.map((i) => i.id)).toEqual(["t1", "t2"]);
    // t3 has no priority, so it lands behind t2.
    const moved2 = applyPendingMoves(state.columns, { t3: { item: state.columns[0].items[1], toKey: "Doing" } });
    expect(moved2[1].items.map((i) => i.id)).toEqual(["t2", "t3"]);
  });

  test("due text is relative to today", () => {
    vi.setSystemTime(new Date(2026, 9, 15, 12));
    expect(formatDue("2026-10-15", null)).toEqual({ text: "today", late: false });
    expect(formatDue("2026-10-16", null)).toEqual({ text: "tmrw", late: false });
    expect(formatDue("2026-10-19", null)).toEqual({ text: "4d", late: false });
    expect(formatDue("2026-11-20", null)).toEqual({ text: "5w", late: false });
    expect(formatDue("2026-10-12", 3)).toEqual({ text: "3d", late: true });
    expect(formatDue(null, null)).toBeNull();
  });
});
