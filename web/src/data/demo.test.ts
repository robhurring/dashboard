import { describe, expect, test, vi } from "vitest";
import type { ServerMsg } from "../protocol/ServerMsg";
import { DemoConnection, isDemo } from "./demo";


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
    await expect(demo.command("echo", "shout")).rejects.toThrow();
  });
});
