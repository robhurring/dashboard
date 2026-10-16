import type { ClientMsg } from "../protocol/ClientMsg";
import type { ServerMsg } from "../protocol/ServerMsg";
import type { SlotDecl } from "../protocol/SlotDecl";
import { trace } from "./trace";
import type { JsonValue } from "../serde_json/JsonValue";
import type { ConnectionState } from "./reduce";

export type SocketLike = {
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};

export type ConnectionDeps = {
  url: string;
  screen: string;
  createSocket: (url: string) => SocketLike;
  apply: (msg: ServerMsg) => void;
  setConnection: (c: ConnectionState) => void;
  getRevs: () => Record<string, number>;
  /** The slots currently mounted on this screen; sent as the watch set. */
  getSlots: () => SlotDecl[];
  /** Called when the server we reconnect to is a different build: the page should reload to match it. */
  reload: (why: string) => void;
};

export const PROTOCOL_VERSION = 1;
const SILENCE_LIMIT_MS = 30_000;
const MAX_BACKOFF_MS = 10_000;

/** The one websocket. Owns reconnecting, heartbeats and command replies; never touches React. */
export class LiveConnection {
  private socket: SocketLike | null = null;
  private open = false;
  private stopped = false;
  /** The server build this page first spoke to. A kiosk has no hand to refresh it; a new build must reload it. */
  private serverBuild: string | null = null;
  private attempt = 0;
  private nextId = 1;
  private silence: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private pending = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  private deps: ConnectionDeps;

  constructor(deps: ConnectionDeps) {
    this.deps = deps;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.socket?.close();
  }

  command(instance: string, action: string, args: JsonValue = {}): Promise<void> {
    if (!this.open) return Promise.reject(new Error("offline"));
    const id = `c-${this.nextId++}`;
    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ type: "command", id, instance, action, args });
    });
  }

  refresh(instance: string) {
    if (this.open) this.send({ type: "refresh", instance });
  }

  /** Resends the current declarations, e.g. after a slot mounts or unmounts. */
  rewatch() {
    if (this.open) this.send({ type: "watch", slots: this.deps.getSlots() });
  }

  private connect() {
    this.deps.setConnection(this.attempt === 0 ? "connecting" : "offline");
    const ws = this.deps.createSocket(this.deps.url);
    this.socket = ws;
    ws.onopen = () => {
      this.open = true;
      this.attempt = 0;
      this.send({ type: "hello", protocol: PROTOCOL_VERSION, screen: this.deps.screen, have: this.deps.getRevs() });
      this.armSilenceTimer();
    };
    ws.onmessage = (ev) => this.onMessage(ev.data);
    ws.onclose = () => this.onDown(ws);
    ws.onerror = () => ws.close();
  }

  private onMessage(data: unknown) {
    if (typeof data !== "string") return;
    let msg: ServerMsg;
    try {
      msg = JSON.parse(data) as ServerMsg;
    } catch {
      return;
    }
    this.armSilenceTimer();
    trace("←", msg);
    switch (msg.type) {
      case "ping":
        this.send({ type: "pong" });
        return;
      case "ack":
        this.settle(msg.id, null);
        return;
      case "fail":
        this.settle(msg.id, msg.error);
        return;
      case "welcome":
        if (this.serverBuild === null) this.serverBuild = msg.server;
        else if (msg.server !== this.serverBuild) {
          this.deps.reload(`server build changed: ${this.serverBuild} -> ${msg.server}`);
          return;
        }
        this.deps.setConnection("online");
        this.deps.apply(msg);
        this.send({ type: "watch", slots: this.deps.getSlots() });
        return;
      default:
        this.deps.apply(msg);
    }
  }

  private settle(id: string, error: string | null) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (error === null) p.resolve();
    else p.reject(new Error(error));
  }

  private onDown(ws: SocketLike) {
    if (ws !== this.socket) return;
    this.open = false;
    this.socket = null;
    if (this.silence) clearTimeout(this.silence);
    for (const p of this.pending.values()) p.reject(new Error("offline"));
    this.pending.clear();
    this.deps.setConnection("offline");
    if (this.stopped) return;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt);
    this.attempt += 1;
    this.retry = setTimeout(() => this.connect(), delay);
  }

  private armSilenceTimer() {
    if (this.silence) clearTimeout(this.silence);
    this.silence = setTimeout(() => this.socket?.close(), SILENCE_LIMIT_MS);
  }

  private send(msg: ClientMsg) {
    trace("→", msg);
    this.socket?.send(JSON.stringify(msg));
  }
}
