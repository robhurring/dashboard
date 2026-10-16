/**
 * Demo mode (`?demo`): the dashboard with made-up data and no server. Used for screenshots and for trying the UI
 * without API keys. Every value here is invented. The echo example's commands work, in this browser only.
 */
import type { InstanceInfo } from "../protocol/InstanceInfo";
import type { ServerMsg } from "../protocol/ServerMsg";
import type { Status } from "../protocol/Status";
import type { JsonValue } from "../serde_json/JsonValue";

export function isDemo(search = location.search): boolean {
  return new URLSearchParams(search).has("demo");
}

type Snap = { info: Omit<InstanceInfo, "id">; config: JsonValue; state: JsonValue; view?: JsonValue; pushed?: boolean };

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function at(daysFromToday: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hour, minute, 0, 0);
  return d;
}
/** ISO time with the local offset: the calendar shows the wall-clock time written in the timestamp. */
function isoLocal(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}
const secs = (d: Date) => Math.floor(d.getTime() / 1000);

function cpuHistory(): number[] {
  const out: number[] = [];
  let v = 18;
  for (let i = 0; i < 120; i++) {
    v += Math.sin(i / 7) * 2.2 + Math.cos(i / 3.1) * 1.4 + (i > 70 && i < 84 ? 3.5 : -0.4);
    v = Math.max(4, Math.min(72, v));
    out.push(Math.round(v * 10) / 10);
  }
  return out;
}

type EchoState = { messages: { text: string; at: number }[]; pings: number };

function snapshots(echo: EchoState = { messages: [], pings: 0 }): Record<string, Snap> {
  const now = new Date();
  const tzOffset = -now.getTimezoneOffset() * 60;
  const nextSlot = Math.ceil((now.getHours() + 1) / 3) * 3;
  const forecast = [0, 1, 2, 3, 4].map((i) => ({
    at: secs(at(0, nextSlot + i * 3)),
    temp: [64, 61, 57, 55, 58][i],
    icon: ["cloud-sun", "cloud", "cloud-rain", "cloud-rain", "cloud"][i],
    pop: [0, 10, 60, 45, 20][i],
  }));
  const history = cpuHistory();
  const cpu = history[history.length - 1];
  const system = { cpu_pct: cpu, mem_pct: 61.4, mem: "9.8 / 16.0 GB", load: "1.12", load_sub: "5m 0.98 · 15m 0.91", uptime: "23d 4h", cpu_history: history, charted_at: secs(now) };
  const gauge = (props: Record<string, JsonValue>) => ({ type: "gauge", props: { big: true, unit: "%", ...props }, children: [] });
  const view = (type: string, props: Record<string, JsonValue>, children: JsonValue[] = []) => ({ type, props, children });

  return {
    "clock:home": {
      info: { module: "clock", kind: "view", component: null, title: null, icon: "clock", push_only: false },
      config: { tz: "America/New_York", label: "New York", date: "dddd, MMMM D", format: "", seconds: false, style: "digital" },
      state: {},
      view: view("clock", { tz: "America/New_York", label: "New York", date: "dddd, MMMM D", format: "", seconds: false, style: "digital" }),
    },
    "weather:home": {
      info: { module: "weather", kind: "state", component: "Weather", title: "Weather: {{state.place}} ({{config.zip}})", icon: "cloud-sun", push_only: false },
      config: { zip: "97201", country: "us", units: "imperial" },
      state: {
        place: "Portland", temp: 63, feels: 62, hi: 66, lo: 54, humidity: 71, wind: 8, sky: "Clouds",
        description: "partly cloudy", icon: "cloud-sun", forecast, tz_offset: tzOffset,
        sunrise: secs(at(0, 7, 18)), sunset: secs(at(0, 18, 26)),
      },
    },
    stocks: {
      info: { module: "stocks", kind: "view", component: null, title: null, icon: "chart-line", push_only: false },
      config: { symbols: ["AAPL", "MSFT", "SPY"], change: "amount" },
      state: {},
      view: view("ticker", { items: [
        { label: "AAPL", value: "231.40", change: "+$2.18", delta: 2.18 },
        { label: "MSFT", value: "428.92", change: "-$1.07", delta: -1.07 },
        { label: "SPY", value: "584.12", change: "+$3.45", delta: 3.45 },
      ] }),
    },
    calendar: {
      info: { module: "calendar", kind: "state", component: "Calendar", title: "Calendar", icon: "calendar", push_only: false },
      config: { days: 3, past: "dim" },
      state: {
        days: 3, from: ymd(now), failed: 0, fetched_at: secs(now),
        events: [
          { title: "Trash and recycling", calendar: "Home", all_day: true, start: ymd(at(0, 0)), end: ymd(at(1, 0)) },
          { title: "Standup", calendar: "Work", all_day: false, start: isoLocal(at(0, 9, 30)), end: isoLocal(at(0, 9, 45)) },
          { title: "Lunch with Sam", calendar: "Personal", all_day: false, start: isoLocal(at(0, 12, 30)), end: isoLocal(at(0, 13, 30)) },
          { title: "Dentist", calendar: "Personal", all_day: false, start: isoLocal(at(0, 16)), end: isoLocal(at(0, 17)) },
          { title: "Soccer practice", calendar: "Family", all_day: false, start: isoLocal(at(1, 17, 30)), end: isoLocal(at(1, 19)) },
          { title: "Design review", calendar: "Work", all_day: false, start: isoLocal(at(2, 11)), end: isoLocal(at(2, 12)) },
        ],
      },
    },
    "system:cpu": {
      info: { module: "system", kind: "view", component: null, title: "Server", icon: "server", push_only: false },
      config: { show: "cpu" }, state: system,
      view: gauge({ label: "CPU", icon: "cpu", sub: "of all cores", value: cpu, stops: { "70": "yellow", "90": "red" } }),
    },
    "system:memory": {
      info: { module: "system", kind: "view", component: null, title: "Server", icon: "server", push_only: false },
      config: { show: "memory" }, state: system,
      view: gauge({ label: "Memory", icon: "memory-stick", sub: system.mem, value: system.mem_pct, stops: { "75": "yellow", "90": "red" } }),
    },
    "system:history": {
      info: { module: "system", kind: "view", component: null, title: "Server", icon: "server", push_only: false },
      config: { show: "history" }, state: system,
      view: view("group", { direction: "column", gap: 4 }, [
        view("line", { points: history, min: 0, max: 100, unit: "%", height: "fill" }),
        view("group", { direction: "row", gap: 6 }, [
          view("stat", { icon: "activity", label: "Load", value: system.load, sub: system.load_sub }),
          view("stat", { icon: "timer", label: "Uptime", value: system.uptime }),
        ]),
      ]),
    },
    echo: {
      info: { module: "echo", kind: "state", component: "Echo", title: "Echo", icon: "message-square", push_only: false },
      config: { keep: 5 }, state: echo as unknown as JsonValue,
    },
    "redis:memory": {
      info: { module: "redis", kind: "view", component: null, title: "Redis {{state.version}}", icon: "redis", push_only: false },
      config: { show: "memory" },
      state: { version: "7.4.1", keys: "128", mem: "3.4 / 256 MB", pct: 1.33, uptime: "12d 6h" },
      view: gauge({ label: "Redis", icon: "redis", tone: "purple", sub: "3.4 / 256 MB · 128 keys", value: 1.33, stops: { "80": "yellow", "95": "red" } }),
    },
  } as Record<string, Snap>;
}

function status(s: Snap): Status {
  const t = Math.floor(Date.now() / 1000);
  return { ok: true, fetched_at: s.pushed ? null : t, pushed_at: s.pushed ? t : null, writer: null, error: null, retry_at: null, loading: false, load_error: null };
}

function snapshotMsg(id: string, s: Snap, rev: number): ServerMsg {
  return { type: "snapshot", instance: id, rev, kind: s.info.kind, view: s.view ?? null, state: s.state, config: s.config, component: s.info.component, status: status(s) };
}

/** Stands in for the websocket connection: same surface as LiveConnection, answered from the data above. */
export class DemoConnection {
  private echo: EchoState = { messages: [], pings: 0 };
  private rev = 1;

  private apply: (m: ServerMsg) => void;

  constructor(apply: (m: ServerMsg) => void) {
    this.apply = apply;
  }

  start(): void {
    const all = snapshots(this.echo);
    const instances: InstanceInfo[] = Object.entries(all).map(([id, s]) => ({ id, ...s.info }));
    this.apply({ type: "welcome", server: "demo", protocol: 1, instances });
    for (const [id, s] of Object.entries(all)) this.apply(snapshotMsg(id, s, this.rev));
  }

  rewatch(): void {}
  refresh(): void {}

  async command(instance: string, action: string, args: JsonValue = {}): Promise<void> {
    if (instance !== "echo") throw new Error("demo mode only runs the echo example's commands");
    return this.echoCommand(action, args);
  }

  /** The same rules as modules/echo/module.lua. */
  private async echoCommand(action: string, args: JsonValue): Promise<void> {
    if (action === "echo") {
      const text = String((args as { text?: unknown } | null)?.text ?? "").trim();
      if (!text) throw new Error("say something first");
      this.echo = { ...this.echo, messages: [{ text, at: Math.floor(Date.now() / 1000) }, ...this.echo.messages].slice(0, 5) };
    } else if (action === "ping") {
      this.echo = { ...this.echo, pings: this.echo.pings + 1 };
    } else throw new Error(`demo: echo has no command ${action}`);
    setTimeout(() => this.apply(snapshotMsg("echo", snapshots(this.echo).echo, ++this.rev)), 100);
  }
}
