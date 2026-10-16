import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LiveConnection, type SocketLike } from "./connection";
import type { ServerMsg } from "../protocol/ServerMsg";

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  sent: unknown[] = [];
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  url: string;
  constructor(url: string) { this.url = url; FakeSocket.all.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { if (!this.closed) { this.closed = true; this.onclose?.({}); } }
  open() { this.onopen?.({}); }
  receive(msg: ServerMsg) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

function make() {
  const applied: ServerMsg[] = [];
  const states: string[] = [];
  const reloads: string[] = [];
  const conn = new LiveConnection({
    url: "ws://test/ws",
    screen: "test",
    createSocket: (u) => new FakeSocket(u),
    apply: (m) => applied.push(m),
    setConnection: (c) => states.push(c),
    getRevs: () => ({ w: 4 }),
    getSlots: () => [{ id: "w", module: "weather", props: { zip: "1" } }],
    reload: (why) => reloads.push(why),
  });
  return { conn, applied, states, reloads, socket: () => FakeSocket.all[FakeSocket.all.length - 1] };
}

const welcome: ServerMsg = { type: "welcome", server: "0.1.0", protocol: 1, instances: [{ id: "w", module: "weather", kind: "view", component: null, title: null, icon: null, push_only: false }] };

beforeEach(() => { vi.useFakeTimers(); FakeSocket.all = []; });
afterEach(() => vi.useRealTimers());

describe("LiveConnection", () => {
  test("says hello with current revs, then watches the catalog", () => {
    const { conn, applied, states, socket } = make();
    conn.start();
    socket().open();
    expect(socket().sent[0]).toEqual({ type: "hello", protocol: 1, screen: "test", have: { w: 4 } });
    socket().receive(welcome);
    expect(states.at(-1)).toBe("online");
    expect(applied[0]).toEqual(welcome);
    expect(socket().sent[1]).toEqual({ type: "watch", slots: [{ id: "w", module: "weather", props: { zip: "1" } }] });
  });

  test("answers pings", () => {
    const { conn, socket } = make();
    conn.start();
    socket().open();
    socket().receive({ type: "ping" });
    expect(socket().sent.at(-1)).toEqual({ type: "pong" });
  });

  test("commands resolve on ack and reject on fail", async () => {
    const { conn, socket } = make();
    conn.start();
    socket().open();
    socket().receive(welcome);
    const ok = conn.command("w", "dismiss", { name: "x" });
    const sent = socket().sent.at(-1) as { id: string };
    expect(sent).toMatchObject({ type: "command", instance: "w", action: "dismiss", args: { name: "x" } });
    socket().receive({ type: "ack", id: sent.id });
    await expect(ok).resolves.toBeUndefined();

    const bad = conn.command("w", "nope");
    socket().receive({ type: "fail", id: (socket().sent.at(-1) as { id: string }).id, error: "unknown command" });
    await expect(bad).rejects.toThrow("unknown command");
  });

  test("reconnects_with_backoff_and_rejects_pending_commands", async () => {
    const { conn, states, socket } = make();
    conn.start();
    socket().open();
    socket().receive(welcome);
    const pending = conn.command("w", "slow");
    socket().close();
    await expect(pending).rejects.toThrow("offline");
    expect(states.at(-1)).toBe("offline");
    await expect(conn.command("w", "x")).rejects.toThrow("offline");

    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(2);
    socket().close(); // second attempt fails too
    vi.advanceTimersByTime(1999);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);
  });

  test("reloads the page when it reconnects to a different server build, never on the first welcome", () => {
    const { conn, reloads, socket } = make();
    conn.start();
    socket().receive({ ...welcome, server: "0.1.0+abc123" });
    expect(reloads).toEqual([]);
    socket().receive({ ...welcome, server: "0.1.0+abc123" }); // a welcome resend from the same build
    expect(reloads).toEqual([]);
    socket().close();
    vi.advanceTimersByTime(2000);
    socket().receive({ ...welcome, server: "0.1.0+def456" }); // the kiosk's server was redeployed
    expect(reloads).toEqual(["server build changed: 0.1.0+abc123 -> 0.1.0+def456"]);
  });

  test("goes offline when the server falls silent", () => {
    const { conn, states, socket } = make();
    conn.start();
    socket().open();
    socket().receive(welcome);
    vi.advanceTimersByTime(30_000);
    expect(socket().closed).toBe(true);
    expect(states.at(-1)).toBe("offline");
  });
});
