/*
 * One example per built-in widget: the Lua a module's `view` returns, the same tree as data (what the
 * server sends), and the widget's options. The gallery theme renders these; bin/screenshots photographs
 * them and writes docs/widgets.md from this file, so the docs, the images and the code can't disagree.
 */
import type { WidgetNode } from "../../src/data/reduce";

export type Example = {
  name: string;
  summary: string;
  lua: string;
  node: WidgetNode;
  options: [string, string][];
  /** Width in px of the panel the example is shown in. */
  width?: number;
  height?: number;
};

const w = (type: string, props: Record<string, unknown> = {}, children: WidgetNode[] = []): WidgetNode =>
  ({ type, props, children }) as WidgetNode;

const cpu = [22, 25, 31, 28, 35, 41, 38, 33, 29, 34, 46, 52, 48, 41, 37, 33, 30, 36, 39, 35];

export const EXAMPLES: Example[] = [
  {
    name: "stat",
    summary: "One figure with a label, a smaller line under it and an optional icon.",
    lua: `ui.stat { value = "63°", label = "Portland", sub = "feels like 62°", icon = "cloud-sun" }`,
    node: w("stat", { value: "63°", label: "Portland", sub: "feels like 62°", icon: "cloud-sun" }),
    options: [["value", "the figure, as text"], ["label", "what it is"], ["sub", "a smaller line underneath"], ["icon", "a Lucide icon name"]],
  },
  {
    name: "gauge",
    summary: "A half-circle meter. Its color changes as the value passes each stop.",
    lua: `ui.gauge {
  value = 82, unit = "%", label = "Memory", sub = "13.1 / 16 GB", icon = "memory-stick",
  stops = { [75] = "yellow", [90] = "red" }, big = true,
}`,
    node: w("gauge", { value: 82, unit: "%", label: "Memory", sub: "13.1 / 16 GB", icon: "memory-stick", stops: { "75": "yellow", "90": "red" }, big: true }),
    options: [
      ["value, max", "the reading and the full scale (default 100)"],
      ["unit, label, sub, icon", "text around the figure"],
      ["stops", "`{ [75] = \"yellow\", [90] = \"red\" }`: the color from each threshold up; names map to theme tones, anything else is a CSS color"],
      ["tone", "the color below the first stop (default the theme accent)"],
      ["big", "`true` to fill the whole panel; without it the gauge is a compact inline meter"],
    ],
    height: 300,
  },
  {
    name: "ticker",
    summary: "Rows of label, value and change, colored up or down.",
    lua: `ui.ticker { items = {
  { label = "AAPL", value = "231.40", delta = 2.18, change = "+$2.18" },
  { label = "MSFT", value = "428.92", delta = -1.07, change = "-$1.07" },
  { label = "SPY", value = "584.12", delta = 0.59 },
} }`,
    node: w("ticker", { items: [
      { label: "AAPL", value: "231.40", delta: 2.18, change: "+$2.18" },
      { label: "MSFT", value: "428.92", delta: -1.07, change: "-$1.07" },
      { label: "SPY", value: "584.12", delta: 0.59 },
    ] }),
    options: [["items", "`{ label, value, delta?, change? }`; `delta` picks the color, `change` is the text shown (else `delta` as a percent)"]],
  },
  {
    name: "line",
    summary: "A sparkline over a list of numbers, oldest first, with the latest value as text.",
    lua: `ui.line { points = state.cpu_history, label = "CPU", unit = "%", min = 0, max = 100 }`,
    node: w("line", { points: cpu, label: "CPU", unit: "%", min: 0, max: 100 }),
    options: [["points", "numbers, oldest first"], ["label, unit", "text for the latest value"], ["min, max", "fix the scale (default: fit the data)"], ["tone", "`accent`, `good`, `warn` or `bad`"], ["height", "in em (default 3.5), or `\"fill\"` for the whole panel"]],
  },
  {
    name: "bar",
    summary: "Vertical bars with labels and values underneath.",
    lua: `ui.bar { label = "Steps", unit = "k", items = {
  { label = "M", value = 8.2 }, { label = "T", value = 11.4 }, { label = "W", value = 6.1 },
  { label = "T", value = 9.8 }, { label = "F", value = 12.3 },
} }`,
    node: w("bar", { label: "Steps", unit: "k", items: [
      { label: "M", value: 8.2 }, { label: "T", value: 11.4 }, { label: "W", value: 6.1 }, { label: "T", value: 9.8 }, { label: "F", value: 12.3 },
    ] }),
    options: [["items", "`{ label, value }`"], ["label, unit", "a caption and the unit after each value"]],
  },
  {
    name: "donut",
    summary: "Parts of a whole, with a legend and a figure in the middle.",
    lua: `ui.donut { center = 48, label = "Disk (GB)", items = {
  { label = "Media", value = 28 }, { label = "Backups", value = 12 }, { label = "Other", value = 8 },
} }`,
    node: w("donut", { center: 48, label: "Disk (GB)", items: [{ label: "Media", value: 28 }, { label: "Backups", value: 12 }, { label: "Other", value: 8 }] }),
    options: [["items", "`{ label, value }`"], ["center", "text in the hole"], ["label", "a caption"]],
  },
  {
    name: "list",
    summary: "Tappable rows. A row's `on_tap` runs one of the module's commands.",
    lua: `ui.list { empty = "Nothing waiting",
  ui.row { title = "#incident-412", meta = "3 new", badge = 3, on_tap = cmd("open", { channel = "incident-412" }) },
  ui.row { title = "#deploys", meta = "build 1.8.2 is out", badge = 1 },
  ui.row { title = "#random", meta = "quiet" },
}`,
    node: w("list", { empty: "Nothing waiting" }, [
      w("row", { title: "#incident-412", meta: "3 new", badge: 3, on_tap: { command: "open", args: { channel: "incident-412" } } }),
      w("row", { title: "#deploys", meta: "build 1.8.2 is out", badge: 1 }),
      w("row", { title: "#random", meta: "quiet" }),
    ]),
    options: [["(children)", "`ui.row`s, as array entries or `children`"], ["empty", "shown when there are no rows"], ["row: title, meta, badge", "the row's text and a count"], ["row: on_tap", "`cmd(\"name\", args)`: runs that command when tapped"]],
  },
  {
    name: "text",
    summary: "A block of markdown: bold, italics, code, lists and line breaks. Links stay plain text.",
    lua: `ui.text { text = "**Bins** go out *tonight*.\\n\\nRecycling is \`blue\` this week." }`,
    node: w("text", { text: "**Bins** go out *tonight*.\n\nRecycling is `blue` this week." }),
    options: [["text", "markdown"]],
  },
  {
    name: "badge",
    summary: "A small count or label in a tone.",
    lua: `ui.group { direction = "row", gap = 2,
  ui.badge { text = "live", tone = "good" },
  ui.badge { text = 3, tone = "warn" },
  ui.badge { text = "down", tone = "bad" },
  ui.badge { text = "idle", tone = "muted" },
}`,
    node: w("group", { direction: "row", gap: 2 }, [
      w("badge", { text: "live", tone: "good" }), w("badge", { text: 3, tone: "warn" }), w("badge", { text: "down", tone: "bad" }), w("badge", { text: "idle", tone: "muted" }),
    ]),
    options: [["text", "a string or number"], ["tone", "`good`, `warn`, `bad` or `muted`"]],
    height: 120,
  },
  {
    name: "icon",
    summary: "A Lucide icon by name, sized in pixels and colored like the text around it.",
    lua: `ui.group { direction = "row", gap = 4,
  ui.icon { name = "sun", size = 28 }, ui.icon { name = "cloud-rain", size = 28 },
  ui.icon { name = "bell", size = 28 }, ui.icon { name = "server", size = 28 },
}`,
    node: w("group", { direction: "row", gap: 4 }, [
      w("icon", { name: "sun", size: 28 }), w("icon", { name: "cloud-rain", size: 28 }), w("icon", { name: "bell", size: 28 }), w("icon", { name: "server", size: 28 }),
    ]),
    options: [["name", "a Lucide icon name from web/src/widgets/icons.tsx"], ["size", "in px (default 20)"]],
    height: 120,
  },
  {
    name: "clock",
    summary: "A clock that ticks in the browser, digital or analog, in any time zone.",
    lua: `ui.group { direction = "row", gap = 6,
  ui.clock { tz = "Europe/London", label = "London", date = "ddd, MMM D" },
  ui.clock { tz = "Asia/Tokyo", label = "Tokyo", style = "analog" },
}`,
    node: w("group", { direction: "row", gap: 6 }, [
      w("clock", { tz: "Europe/London", label: "London", date: "ddd, MMM D" }),
      w("clock", { tz: "Asia/Tokyo", label: "Tokyo", style: "analog" }),
    ]),
    height: 360,
    options: [["tz", "an IANA time zone"], ["label", "a caption"], ["style", "`digital` or `analog`"], ["seconds", "`true` to show seconds"], ["format", "e.g. `h:mm a`"], ["date", "`true`, or a format like `dddd, MMMM D`"]],
    width: 520,
  },
  {
    name: "group",
    summary: "Stacks other widgets in a row or a column. Most views are a group at the top.",
    lua: `ui.group { direction = "column", gap = 3,
  ui.group { direction = "row", gap = 6,
    ui.stat { value = "1.12", label = "Load", icon = "activity" },
    ui.stat { value = "23d", label = "Uptime", icon = "timer" },
  },
  ui.line { points = state.cpu_history, unit = "%", min = 0, max = 100 },
}`,
    node: w("group", { direction: "column", gap: 3 }, [
      w("group", { direction: "row", gap: 6 }, [w("stat", { value: "1.12", label: "Load", icon: "activity" }), w("stat", { value: "23d", label: "Uptime", icon: "timer" })]),
      w("line", { points: cpu, unit: "%", min: 0, max: 100 }),
    ]),
    options: [["direction", "`column` (default) or `row`"], ["gap", "space between children, in quarter-rem steps"], ["(children)", "any widgets, as array entries or `children`"]],
    width: 520,
  },
];
