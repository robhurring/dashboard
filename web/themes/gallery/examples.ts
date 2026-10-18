/*
 * One example per built-in widget: the Lua a module's `view` returns, the same tree as data (what the
 * server sends), and the widget's options. The gallery theme renders these; bin/screenshots photographs
 * them and writes docs/widgets.md from this file, so the docs, the images and the code can't disagree.
 */
import type { WidgetNode } from "../../src/data/reduce";
import { SAMPLE_PNG, SAMPLE_WAV } from "./media.ts";

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

const releaseNotes = [
  "## Release 1.8",
  "",
  "Shipped **today**. Notes at [example.com](https://example.com).",
  "",
  "- [x] migrate the database",
  "- [ ] announce it",
  "",
  "| Service | Status |",
  "|---|---|",
  "| api | up |",
  "| worker | ~~down~~ up |",
  "",
  "```sh",
  "bin/deploy prod",
  "```",
].join("\n");

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
    name: "progress",
    summary: "A horizontal bar of value out of max. Stops color it by how full it is, so a balance can turn yellow, then red, as it runs down.",
    lua: `ui.progress {
  value = 9.96, max = 10, label = "Balance", text = "$9.96 left of $10.00",
  stops = { [0] = "red", [10] = "yellow", [25] = "green" },   -- by percent full
}`,
    node: w("progress", { value: 9.96, max: 10, label: "Balance", text: "$9.96 left of $10.00", stops: { "0": "red", "10": "yellow", "25": "green" } }),
    options: [["value, max", "how full (max defaults to 100)"], ["label, text", "a label, and text on the right"], ["stops", "`{ [0] = \"red\", [10] = \"yellow\", [25] = \"green\" }`: the color from each percent up"], ["tone", "the color without stops (default the theme accent)"]],
    height: 140,
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
    summary: "Short markdown for digests: bold, italics, inline code, lists and small headings. For anything richer, use ui.markdown.",
    lua: `ui.text { text = "**Bins** go out *tonight*.\\n\\nRecycling is \`blue\` this week." }`,
    node: w("text", { text: "**Bins** go out *tonight*.\n\nRecycling is `blue` this week." }),
    options: [["text", "markdown"]],
  },
  {
    name: "markdown",
    summary: "Full markdown for a rich tile: headings, links, task lists, tables, code blocks, quotes and images. Raw HTML is never rendered.",
    lua: `ui.markdown { text = [[\n${releaseNotes}\n]] }`,
    node: w("markdown", { text: releaseNotes }),
    options: [["text", "markdown, GitHub-flavoured"], ["links", "`false` renders links as plain text, for screens that must never navigate away (default: links open in a new tab)"]],
    width: 520,
    height: 430,
  },
  {
    name: "button",
    summary: "Runs one of the module's commands when tapped: refresh, run a scene, snooze. Shows the command's error if it fails.",
    lua: `ui.button { label = "Movie night", icon = "clapperboard", on_tap = cmd("scene", { name = "movie" }) }`,
    node: w("button", { label: "Movie night", icon: "clapperboard", on_tap: { command: "scene", args: { name: "movie" } } }),
    options: [["label, icon", "text and a Lucide icon"], ["on_tap", "`cmd(\"name\", args)`: the command it runs"]],
    height: 140,
  },
  {
    name: "toggle",
    summary: "On or off, iOS style: a switch in a row, a pill to slide (upright like a wall switch), or a Control Center tile. Flips at once; goes back and says why if the command fails.",
    lua: `ui.group { direction = "column", gap = 4,
  ui.toggle { label = "Kitchen lights", icon = "lightbulb", icon_off = "lightbulb-off", on = true,
              on_change = cmd("light", { id = "kitchen" }) },        -- the command gets value = true/false
  ui.group { direction = "row", gap = 4,
    ui.toggle { label = "Porch", style = "slide", orientation = "vertical", icon = "lamp", on = false, on_change = cmd("porch") },
    ui.toggle { label = "Fan", style = "tile", icon = "fan", sub = "Bedroom", on = true, on_change = cmd("fan") },
  },
}`,
    node: w("group", { direction: "column", gap: 4 }, [
      w("toggle", { label: "Kitchen lights", icon: "lightbulb", icon_off: "lightbulb-off", on: true, on_change: { command: "light", args: { id: "kitchen" } } }),
      w("group", { direction: "row", gap: 4 }, [
        w("toggle", { label: "Porch", style: "slide", orientation: "vertical", icon: "lamp", on: false, on_change: { command: "porch", args: {} } }),
        w("toggle", { label: "Fan", style: "tile", icon: "fan", sub: "Bedroom", on: true, on_change: { command: "fan", args: {} } }),
      ]),
    ]),
    options: [
      ["on", "the current state, from the module"],
      ["on_change", "`cmd(\"name\", args)`: runs with `value = true` or `false` added to args"],
      ["label, sub", "text"],
      ["icon, icon_off", "a Lucide icon, and one for while it's off"],
      ["style", "`switch` (default), `slide` or `tile`"],
      ["orientation", "for `slide`: `horizontal` (default) or `vertical`"],
      ["tone", "the on color (default `good`, green)"],
    ],
    width: 520,
    height: 380,
  },
  {
    name: "slider",
    summary: "A Control Center slider: a fat track that fills as you drag, horizontal or upright. Sends the value once, when let go.",
    lua: `ui.group { direction = "row", gap = 6,
  ui.slider { label = "Brightness", icon = "sun", value = 60, unit = "%", orientation = "vertical", on_change = cmd("dim", { id = "kitchen" }) },
  ui.slider { label = "Volume", icon = "volume-2", value = 35, orientation = "vertical", on_change = cmd("volume") },
}`,
    node: w("group", { direction: "row", gap: 6 }, [
      w("slider", { label: "Brightness", icon: "sun", value: 60, unit: "%", orientation: "vertical", on_change: { command: "dim", args: { id: "kitchen" } } }),
      w("slider", { label: "Volume", icon: "volume-2", value: 35, orientation: "vertical", on_change: { command: "volume", args: {} } }),
    ]),
    options: [
      ["value, min, max, step", "the current value (from the module) and its range (default 0 to 100, step 1)"],
      ["on_change", "`cmd(\"name\", args)`: runs with `value` added, once you let go"],
      ["label, unit, icon", "text, a unit after the value, and a Lucide icon on the track"],
      ["orientation", "`horizontal` (default) or `vertical`"],
    ],
    height: 300,
  },
  {
    name: "choice",
    summary: "Pick one of a few options: a scene, a mode. The current one is highlighted; tapping another runs the command.",
    lua: `ui.choice { label = "Scene", value = state.scene,
  options = { "Day", { value = "movie", label = "Movie night" }, "Off" },
  on_change = cmd("scene") }   -- runs with value = the option's value`,
    node: w("choice", { label: "Scene", value: "Day", options: ["Day", { value: "movie", label: "Movie night" }, "Off"], on_change: { command: "scene", args: {} } }),
    options: [["options", "strings, or `{ value, label }`"], ["value", "the current option, from the module"], ["on_change", "`cmd(\"name\", args)`: runs with `value` added"], ["label", "a caption"]],
    height: 160,
  },
  {
    name: "image",
    summary: "An image, inline as base64 (`data`) or from a URL (`src`). Pairs with openrouter.image() for generated pictures.",
    lua: `local picture = openrouter.image(ctx, "A watercolor of the garden at dawn")  -- in fetch

ui.image { data = state.picture.data, type = state.picture.type, alt = "The garden at dawn" }
-- or: ui.image { src = "https://example.com/garden.jpg", alt = "The garden" }`,
    node: w("image", { data: SAMPLE_PNG, type: "image/png", alt: "The garden at dawn", fit: "cover" }),
    options: [["data, type", "base64 image data and its type (default image/png); a full data: URL works too"], ["src", "an image URL, instead of data"], ["alt", "what the image shows"], ["fit", "`contain` (default) or `cover`"]],
    height: 260,
  },
  {
    name: "audio",
    summary: "A clip with a play button, inline as base64 or from a URL. With autoplay, each new clip plays as it arrives: an announcement.",
    lua: `local clip = openrouter.speak(ctx, "Your 3pm is in ten minutes")  -- in fetch

ui.audio { data = state.clip.data, type = state.clip.type, label = "Next meeting", autoplay = true }`,
    node: w("audio", { data: SAMPLE_WAV, type: "audio/wav", label: "Next meeting" }),
    options: [["data, type", "base64 audio and its type (default audio/mpeg); a full data: URL works too"], ["src", "an audio URL, instead of data"], ["label", "shown beside the button"], ["autoplay", "`true` plays each new clip as it arrives (not the one already there when the page loads)"]],
    height: 140,
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
