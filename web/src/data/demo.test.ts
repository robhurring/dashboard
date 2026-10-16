import { describe, expect, test, vi } from "vitest";
import type { ServerMsg } from "../protocol/ServerMsg";
import { DemoConnection, isDemo } from "./demo";

type Board = { columns: { key: string; items: { id: string }[] }[]; total: number };

function board(msgs: ServerMsg[]): Board {
  const last = msgs.filter((m) => m.type === "snapshot" && m.instance === "todoist").at(-1);
  return (last as Extract<ServerMsg, { type: "snapshot" }>).state as unknown as Board;
}
const column = (b: Board, key: string) => b.columns.find((c) => c.key === key)!.items.map((i) => i.id);

describe("demo mode", () => {
  test("is on only with ?demo", () => {
    expect(isDemo("?demo")).toBe(true);
    expect(isDemo("?theme=wall&demo=1")).toBe(true);
    expect(isDemo("?theme=wall")).toBe(false);
  });

  test("start sends a welcome and a snapshot for every instance in the catalog", () => {
    const msgs: ServerMsg[] = [];
    new DemoConnection((m) => msgs.push(m)).start();
    const welcome = msgs[0] as Extract<ServerMsg, { type: "welcome" }>;
    expect(welcome.type).toBe("welcome");
    const snapped = msgs.filter((m) => m.type === "snapshot").map((m) => (m as { instance: string }).instance);
    expect(snapped.sort()).toEqual(welcome.instances.map((i) => i.id).sort());
  });

  test("todoist moves, completes and reopens tasks with a fresh snapshot each time", async () => {
    vi.useFakeTimers();
    const msgs: ServerMsg[] = [];
    const demo = new DemoConnection((m) => msgs.push(m));
    demo.start();
    const total = board(msgs).total;

    await demo.command("todoist", "move", { id: "t3", section_id: "sec-working" });
    vi.advanceTimersByTime(300);
    expect(column(board(msgs), "Working")).toContain("t3");
    expect(column(board(msgs), "backlog")).not.toContain("t3");

    await demo.command("todoist", "complete", { id: "t3" });
    vi.advanceTimersByTime(300);
    expect(board(msgs).total).toBe(total - 1);

    await demo.command("todoist", "reopen", { id: "t3" });
    vi.advanceTimersByTime(300);
    expect(board(msgs).total).toBe(total);
    vi.useRealTimers();
  });

  test("the echo example runs its commands like the real module", async () => {
    vi.useFakeTimers();
    const msgs: ServerMsg[] = [];
    const demo = new DemoConnection((m) => msgs.push(m));
    demo.start();
    await demo.command("echo", "echo", { text: "  hi  " });
    await demo.command("echo", "ping");
    vi.advanceTimersByTime(300);
    const last = msgs.filter((m) => m.type === "snapshot" && m.instance === "echo").at(-1) as Extract<ServerMsg, { type: "snapshot" }>;
    expect(last.state).toMatchObject({ messages: [{ text: "hi" }], pings: 1 });
    await expect(demo.command("echo", "echo", { text: " " })).rejects.toThrow("say something first");
    vi.useRealTimers();
  });

  test("commands it cannot run are rejected", async () => {
    const demo = new DemoConnection(() => {});
    demo.start();
    await expect(demo.command("stocks", "refresh")).rejects.toThrow();
    await expect(demo.command("todoist", "complete", { id: "nope" })).rejects.toThrow();
  });
});
