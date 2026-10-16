/**
 * Demo mode (`?demo`): the dashboard with made-up data and no server. Used for screenshots and for trying the UI
 * without API keys. Every value here is invented. Todoist moves and completions work, in this browser only.
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

type Task = {
  id: string; content: string; description: string; due: string | null; priority: number; project_name: string;
  labels: string[]; days_overdue: number | null; overdue: boolean; section_id: string | null; added_at: string;
  updated_at: string; is_recurring: boolean;
};

function task(id: string, content: string, opts: Partial<Task> = {}): Task {
  const added = at(-3, 9).toISOString();
  return {
    id, content, description: "", due: null, priority: 1, project_name: "Inbox", labels: [], days_overdue: null,
    overdue: false, section_id: null, added_at: added, updated_at: added, is_recurring: false, ...opts,
  };
}

const sections = [
  { key: "backlog", label: "Backlog", section_id: null },
  { key: "Working", label: "Working", section_id: "sec-working" },
  { key: "Tracking", label: "Tracking", section_id: "sec-tracking" },
];

function initialTasks(): Task[] {
  return [
    task("t1", "Replace the garage door sensor battery", {
      priority: 4, due: ymd(at(-1, 0)), days_overdue: 1, overdue: true, labels: ["home"],
      description: "The opener blinks twice when it closes. CR2032, two in the junk drawer.",
    }),
    task("t2", "Book flights for Thanksgiving", { priority: 3, due: ymd(at(2, 0)), labels: ["travel"] }),
    task("t3", "Write the README banner", { priority: 2, labels: ["dashboard"] }),
    task("t4", "Renew car registration", { due: ymd(at(9, 0)) }),
    task("t5", "Try the hourly forecast as the weather hero", { labels: ["dashboard"] }),
    task("t6", "Set up the Pi 5 kiosk", {
      priority: 3, section_id: "sec-working", labels: ["homelab"],
      description: "Flash the image, copy pi/ over, run setup.sh. Check the touch rotation after the first boot.",
    }),
    task("t7", "Water the plants", { section_id: "sec-working", is_recurring: true, due: ymd(at(0, 0)) }),
    task("t8", "Waiting on the contractor's quote", { section_id: "sec-tracking", labels: ["home"] }),
    task("t9", "Router RMA shipped back", { section_id: "sec-tracking", due: ymd(at(4, 0)) }),
  ];
}

function order(a: Task, b: Task): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.id < b.id ? -1 : 1;
}

function board(tasks: Task[]): JsonValue {
  const columns = sections.map((s) => ({
    key: s.key, label: s.label, ...(s.section_id ? { section_id: s.section_id } : {}),
    items: tasks.filter((t) => t.section_id === s.section_id).sort(order),
  }));
  return { columns, total: tasks.length, project_id: "demo-inbox", synced_at: secs(new Date()) } as unknown as JsonValue;
}

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

function digest(topic: string): string {
  const names: Record<string, string> = { ai: "AI", openai: "OpenAI" };
  const name = names[topic] ?? topic.charAt(0).toUpperCase() + topic.slice(1);
  return [
    `# ${name} News Digest (demo)`,
    "## About this panel",
    `- **Digests from a webhook**: the news module asks a workflow (n8n, here) for a summary of ${name} news and lays it out in sections.`,
    "- **Plain markdown in**: a title, section headings and bulleted items with a bold lead. Anything else still renders as markdown.",
    "## In demo mode",
    "- **Sample text**: point the module at a summary webhook and real digests replace this.",
  ].join("\n");
}

function snapshots(tasks: Task[]): Record<string, Snap> {
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
    todoist: {
      info: { module: "todoist", kind: "state", component: "TodoistBoard", title: "Tasks · {{state.total}} open", icon: "list-todo", push_only: false },
      config: { project: "inbox" }, state: board(tasks),
    },
    "clock:home": {
      info: { module: "clock", kind: "view", component: null, title: null, icon: "clock", push_only: false },
      config: { tz: "America/New_York", label: "New York", date: "dddd, MMMM D", format: "", seconds: false, style: "digital" },
      state: {},
      view: view("clock", { tz: "America/New_York", label: "New York", date: "dddd, MMMM D", format: "", seconds: false, style: "digital" }),
    },
    slack: {
      info: { module: "slack", kind: "state", component: "SlackStats", title: "Slack", icon: "message-square", push_only: true },
      config: {}, pushed: true,
      state: { items: [
        { label: "DMs", number: 2, order: 1, tone: "bad", ring: true },
        { label: "Mentions", number: 5, order: 2, icon: "at-sign" },
        { label: "Threads", number: 3, order: 3, icon: "messages-square" },
      ], pushed_at: secs(now) },
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
    ainews: {
      info: { module: "ainews", kind: "state", component: "Headlines", title: "AI news", icon: "sparkles", push_only: false },
      config: { limit: 12 },
      state: { fetched_at: secs(now), items: [
        "Sample headline: the AI news panel lists recent stories from a feed",
        "Each item shows its source and how long ago it was published",
        "Tap a headline on the kiosk to open its summary",
        "Point the module at any feed that returns title, source and time",
      ].map((title, i) => ({ title, source: "Demo feed", summary: "", url: "https://example.com/", published_at: new Date(now.getTime() - (i + 1) * 47 * 60_000).toISOString() })) },
    },
    ...Object.fromEntries(["technology", "ai", "openai", "anthropic", "salesforce"].map((topic) => [`news:${topic}`, {
      info: { module: "news", kind: "state", component: "News", title: "News · {{config.topic}}", icon: "newspaper", push_only: false },
      config: { topic, count: 5 }, state: { topic, markdown: digest(topic), fetched_at: secs(now) },
    } satisfies Snap])),
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
  private tasks = initialTasks();
  private done = new Map<string, Task>();
  private rev = 1;

  private apply: (m: ServerMsg) => void;

  constructor(apply: (m: ServerMsg) => void) {
    this.apply = apply;
  }

  start(): void {
    const all = snapshots(this.tasks);
    const instances: InstanceInfo[] = Object.entries(all).map(([id, s]) => ({ id, ...s.info }));
    this.apply({ type: "welcome", server: "demo", protocol: 1, instances });
    for (const [id, s] of Object.entries(all)) this.apply(snapshotMsg(id, s, this.rev));
  }

  rewatch(): void {}
  refresh(): void {}

  async command(instance: string, action: string, args: JsonValue = {}): Promise<void> {
    if (instance !== "todoist") throw new Error("demo mode only runs Todoist commands");
    const a = args as { id?: string; section_id?: string | null };
    const found = this.tasks.find((t) => t.id === a.id);
    if (action === "move" && found) found.section_id = a.section_id ?? null;
    else if (action === "complete" && found) {
      this.tasks = this.tasks.filter((t) => t !== found);
      this.done.set(found.id, found);
    } else if (action === "reopen" && a.id && this.done.has(a.id)) {
      this.tasks.push(this.done.get(a.id)!);
      this.done.delete(a.id);
    } else throw new Error(`demo: cannot ${action} that task`);
    // A beat like a real round trip, then the "server" confirms with a fresh snapshot.
    setTimeout(() => this.apply(snapshotMsg("todoist", snapshots(this.tasks).todoist, ++this.rev)), 250);
  }
}
