/*
 * The widget gallery: every built-in widget, several ways each. Each example is a widget tree (what a
 * module's view returns) plus the page it's shown on; its Lua is generated from the tree, so the docs,
 * the images and the code can't disagree. bin/screenshots photographs them and writes docs/widgets.md
 * from this file.
 */
import type { WidgetNode } from "../../src/data/reduce";
import { SAMPLE_PNG, SAMPLE_WAV } from "./media.ts";

export const PAGES = [
  { id: "figures", title: "Figures" },
  { id: "meters", title: "Meters" },
  { id: "trends", title: "Trends" },
  { id: "charts", title: "Charts" },
  { id: "text", title: "Text, lists and icons" },
  { id: "markdown", title: "Markdown" },
  { id: "toggles", title: "Toggles" },
  { id: "sliders", title: "Sliders and choices" },
  { id: "buttons", title: "Buttons and media" },
  { id: "titles", title: "Titles" },
  { id: "time", title: "Time and layout" },
] as const;
export type PageId = (typeof PAGES)[number]["id"];

export type Example = {
  name: string;
  /** What this example shows, when it's one of several for the same widget. */
  variant?: string;
  page: PageId;
  node: WidgetNode;
  /** Hand-written Lua, when the example is about where the data comes from; otherwise generated. */
  lua?: string;
  /** Size of its gallery panel, in px. */
  width?: number;
  height?: number;
};

export const exampleId = (ex: Example) => (ex.variant ? `${ex.name}-${ex.variant.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : ex.name);

type Props = Record<string, unknown>;
const w = (type: string, props: Props = {}, children: WidgetNode[] = []): WidgetNode => ({ type, props, children }) as WidgetNode;
const act = (command: string, args: Props = {}) => ({ command, args });

// ─── Lua from a widget tree ───────────────────────────────────────────────

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const isAction = (v: unknown): v is { command: string; args: Props } => typeof v === "object" && v !== null && "command" in v && "args" in v;

function luaValue(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null || v === undefined) return "nil";
  if (isAction(v)) return Object.keys(v.args).length ? `cmd(${JSON.stringify(v.command)}, ${luaValue(v.args)})` : `cmd(${JSON.stringify(v.command)})`;
  if (Array.isArray(v)) return `{ ${v.map(luaValue).join(", ")} }`;
  const entries = Object.entries(v as Props).map(([k, x]) => `${/^-?\d+(\.\d+)?$/.test(k) ? `[${k}]` : IDENT.test(k) ? k : `[${JSON.stringify(k)}]`} = ${luaValue(x)}`);
  return entries.length ? `{ ${entries.join(", ")} }` : "{}";
}

/** A widget tree as the Lua that builds it: `ui.stat { value = "1", label = "x" }`. */
export function toLua(node: WidgetNode, indent = ""): string {
  const props = Object.entries((node.props ?? {}) as Props).map(([k, v]) => `${k} = ${luaValue(v)}`);
  const kids = (node.children ?? []).map((c) => toLua(c, indent + "  "));
  const flat = `ui.${node.type} { ${[...props, ...kids].join(", ")} }`;
  if (kids.length === 0 && flat.length + indent.length <= 96) return flat;
  const inner = indent + "  ";
  const lines = [...props.map((p) => `${inner}${p},`), ...kids.map((k) => `${inner}${k},`)];
  return `ui.${node.type} {\n${lines.join("\n")}\n${indent}}`;
}

export const luaFor = (ex: Example) => ex.lua ?? toLua(ex.node);

// ─── Sample data ──────────────────────────────────────────────────────────

const cpu = [22, 25, 31, 28, 35, 41, 38, 33, 29, 34, 46, 52, 48, 41, 37, 33, 30, 36, 39, 35];
const temps = [61, 60, 59, 58, 58, 60, 63, 66, 69, 71, 72, 72, 70, 67, 64, 62];
const DEPLETION = { "0": "red", "10": "yellow", "25": "green" };
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
const kitchenNotes = [
  "### Kitchen",
  "",
  "> Dishwasher runs at **10 pm**.",
  "",
  "1. Empty the compost",
  "2. Water the basil",
  "",
  "Recipe: [shakshuka](https://example.com/shakshuka)",
].join("\n");

// ─── The examples ─────────────────────────────────────────────────────────

export const EXAMPLES: Example[] = [
  // Figures
  { name: "stat", page: "figures", node: w("stat", { value: "63°", label: "Portland", sub: "feels like 62°", icon: "cloud-sun" }) },
  { name: "stat", variant: "Without an icon", page: "figures", node: w("stat", { value: "1,284", label: "Steps today", sub: "goal 8,000" }) },
  { name: "gauge", page: "figures", node: w("gauge", { value: 82, unit: "%", label: "Memory", sub: "13.1 / 16 GB", icon: "memory-stick", stops: { "75": "yellow", "90": "red" }, big: true }), height: 280 },
  { name: "gauge", variant: "Low and green", page: "figures", node: w("gauge", { value: 23, unit: "%", label: "CPU", sub: "of all cores", icon: "cpu", stops: { "70": "yellow", "90": "red" }, big: true }), height: 280 },
  { name: "gauge", variant: "Past the red stop", page: "meters", node: w("gauge", { value: 96, unit: "%", label: "Disk", sub: "1.9 / 2 TB", icon: "hard-drive", stops: { "75": "yellow", "90": "red" }, big: true }), height: 300 },
  { name: "gauge", variant: "A fixed tone", page: "meters", node: w("gauge", { value: 41, unit: "%", label: "Redis", icon: "redis", tone: "purple", big: true }), height: 300 },
  { name: "gauge", variant: "Compact, in a row", page: "figures", node: w("group", { direction: "row", gap: 4 }, [w("gauge", { value: 64, unit: "%", label: "Humidity" }), w("gauge", { value: 12, max: 20, unit: " mph", label: "Wind" })]), width: 360, height: 220 },

  // Trends
  { name: "progress", page: "meters", node: w("progress", { value: 9.96, max: 10, label: "Balance", text: "$9.96 left of $10.00", stops: DEPLETION }), height: 130 },
  { name: "progress", variant: "Running low", page: "meters", node: w("progress", { value: 1.8, max: 10, label: "Balance", text: "$1.80 left of $10.00", stops: DEPLETION }), height: 130 },
  { name: "progress", variant: "Nearly out", page: "meters", node: w("progress", { value: 0.6, max: 10, label: "Balance", text: "$0.60 left of $10.00", stops: DEPLETION }), height: 130 },
  { name: "progress", variant: "Plain, in the accent", page: "meters", node: w("progress", { value: 40, label: "Backup", text: "40%" }), height: 130 },
  { name: "ticker", page: "trends", node: w("ticker", { items: [{ label: "AAPL", value: "231.40", delta: 2.18, change: "+$2.18" }, { label: "MSFT", value: "428.92", delta: -1.07, change: "-$1.07" }, { label: "SPY", value: "584.12", delta: 0.59 }] }) },
  { name: "ticker", variant: "Percent changes", page: "trends", node: w("ticker", { items: [{ label: "BTC", value: "67,410", delta: 3.2 }, { label: "ETH", value: "3,120", delta: -0.8 }, { label: "Gold", value: "2,340", delta: 0.1 }] }) },
  { name: "line", page: "trends", node: w("line", { points: cpu, label: "CPU", unit: "%", min: 0, max: 100 }) },
  { name: "line", variant: "A tone and its own range", page: "trends", node: w("line", { points: temps, label: "Outside", unit: "°", tone: "good", height: 5 }) },
  { name: "bar", page: "charts", node: w("bar", { label: "Steps", unit: "k", items: [{ label: "M", value: 8.2 }, { label: "T", value: 11.4 }, { label: "W", value: 6.1 }, { label: "T", value: 9.8 }, { label: "F", value: 12.3 }] }) },
  { name: "donut", page: "charts", node: w("donut", { center: 48, label: "Disk (GB)", items: [{ label: "Media", value: 28 }, { label: "Backups", value: 12 }, { label: "Other", value: 8 }] }) },
  { name: "donut", variant: "A budget", page: "charts", node: w("donut", { center: "$620", label: "October", items: [{ label: "Groceries", value: 310 }, { label: "Dining", value: 140 }, { label: "Fuel", value: 90 }, { label: "Other", value: 80 }] }) },

  // Text
  { name: "text", page: "text", node: w("text", { text: "**Bins** go out *tonight*.\n\nRecycling is `blue` this week." }) },
  { name: "text", variant: "A digest", page: "text", node: w("text", { text: "### Today\n- **Standup** moved to 10:00\n- Dentist at 4\n- Package arriving" }) },
  { name: "markdown", page: "markdown", node: w("markdown", { text: releaseNotes }), lua: `ui.markdown { text = [[\n${releaseNotes}\n]] }`, width: 520, height: 430 },
  { name: "markdown", variant: "Links as plain text", page: "markdown", node: w("markdown", { text: kitchenNotes, links: false }), lua: `ui.markdown { links = false, text = [[\n${kitchenNotes}\n]] }`, width: 360, height: 300 },

  // Lists and badges
  { name: "list", page: "text", node: w("list", { empty: "Nothing waiting" }, [
    w("row", { title: "#incident-412", meta: "3 new", badge: 3, on_tap: act("open", { channel: "incident-412" }) }),
    w("row", { title: "#deploys", meta: "build 1.8.2 is out", badge: 1 }),
    w("row", { title: "#random", meta: "quiet" }),
  ]) },
  { name: "list", variant: "Empty", page: "text", node: w("list", { empty: "Inbox zero" }), height: 140 },
  { name: "badge", page: "text", node: w("group", { direction: "row", gap: 2 }, [w("badge", { text: "live", tone: "good" }), w("badge", { text: 3, tone: "warn" }), w("badge", { text: "down", tone: "bad" }), w("badge", { text: "idle", tone: "muted" })]), height: 120 },
  { name: "icon", page: "text", node: w("group", { direction: "row", gap: 4 }, [w("icon", { name: "sun", size: 28 }), w("icon", { name: "cloud-rain", size: 28 }), w("icon", { name: "bell", size: 28 }), w("icon", { name: "server", size: 28 })]), height: 120 },
  { name: "icon", variant: "Any Lucide icon", page: "text", node: w("group", { direction: "row", gap: 4 }, [w("icon", { name: "lightbulb", size: 28 }), w("icon", { name: "thermometer", size: 28 }), w("icon", { name: "door-open", size: 28 }), w("icon", { name: "droplets", size: 28 }), w("icon", { name: "lock", size: 28 }), w("icon", { name: "fan", size: 28 })]), height: 120 },

  // Toggles
  { name: "toggle", page: "toggles", node: w("group", { direction: "column", gap: 4 }, [
    w("toggle", { label: "Kitchen lights", icon: "lightbulb", icon_off: "lightbulb-off", on: true, on_change: act("light", { id: "kitchen" }) }),
    w("toggle", { label: "Hallway", sub: "motion sensor", icon: "lightbulb", icon_off: "lightbulb-off", on: false, on_change: act("light", { id: "hall" }) }),
    w("toggle", { label: "Do not disturb", icon: "moon", on: true, tone: "purple", on_change: act("dnd") }),
  ]), width: 400, height: 260 },
  { name: "toggle", variant: "Slide", page: "toggles", node: w("toggle", { label: "Slide to unlock", style: "slide", icon: "lock-open", on: false, on_change: act("door") }), width: 400, height: 140 },
  { name: "toggle", variant: "Upright slides", page: "toggles", node: w("group", { direction: "row", gap: 6 }, [
    w("toggle", { label: "Porch", style: "slide", orientation: "vertical", icon: "lamp", on: false, on_change: act("porch") }),
    w("toggle", { label: "Garage", style: "slide", orientation: "vertical", icon: "warehouse", on: true, on_change: act("garage") }),
  ]), width: 300, height: 300 },
  { name: "toggle", variant: "Tiles", page: "toggles", node: w("group", { direction: "row", gap: 4 }, [
    w("toggle", { label: "Fan", style: "tile", icon: "fan", sub: "Bedroom", on: true, on_change: act("fan") }),
    w("toggle", { label: "Front door", style: "tile", icon: "lock", sub: "Locked", on: false, on_change: act("lock") }),
    w("toggle", { label: "Sprinklers", style: "tile", icon: "droplets", sub: "Zone 2", on: true, tone: "accent", on_change: act("zone", { id: 2 }) }),
  ]), width: 520, height: 230 },

  // Sliders and choices
  { name: "slider", page: "sliders", node: w("group", { direction: "row", gap: 6 }, [
    w("slider", { label: "Brightness", icon: "sun", value: 60, unit: "%", orientation: "vertical", on_change: act("dim", { id: "kitchen" }) }),
    w("slider", { label: "Volume", icon: "volume-2", value: 35, orientation: "vertical", on_change: act("volume") }),
  ]), height: 300 },
  { name: "slider", variant: "Horizontal", page: "sliders", node: w("slider", { label: "Thermostat", icon: "thermometer", min: 60, max: 80, value: 68, unit: "°", on_change: act("thermostat") }), width: 400, height: 150 },
  { name: "slider", variant: "Stepped", page: "sliders", node: w("slider", { label: "Fan speed", icon: "fan", min: 0, max: 5, step: 1, value: 2, on_change: act("fan_speed") }), width: 400, height: 150 },
  { name: "choice", page: "sliders", node: w("choice", { label: "Scene", value: "Day", options: ["Day", { value: "movie", label: "Movie night" }, "Off"], on_change: act("scene") }), width: 400, height: 160 },
  { name: "choice", variant: "Modes", page: "sliders", node: w("choice", { label: "Heat pump", value: "auto", options: [{ value: "heat", label: "Heat" }, { value: "cool", label: "Cool" }, { value: "auto", label: "Auto" }, { value: "off", label: "Off" }], on_change: act("hvac_mode") }), width: 400, height: 160 },

  // Buttons
  { name: "button", page: "buttons", node: w("button", { label: "Movie night", icon: "clapperboard", on_tap: act("scene", { name: "movie" }) }), height: 140 },
  { name: "button", variant: "A row of actions", page: "buttons", node: w("group", { direction: "row", gap: 3 }, [
    w("button", { label: "Refresh", icon: "refresh-cw", on_tap: act("refresh") }),
    w("button", { label: "Snooze", icon: "alarm-clock-off", on_tap: act("snooze", { minutes: 10 }) }),
    w("button", { label: "All off", icon: "power", on_tap: act("all_off") }),
  ]), width: 520, height: 140 },

  // Media
  { name: "image", page: "buttons", node: w("image", { data: SAMPLE_PNG, type: "image/png", alt: "The garden at dawn", fit: "cover" }), height: 260,
    lua: `local picture = openrouter.image(ctx, "A watercolor of the garden at dawn")  -- in fetch\n\nui.image { data = state.picture.data, type = state.picture.type, alt = "The garden at dawn" }\n-- or: ui.image { src = "https://example.com/garden.jpg", alt = "The garden" }` },
  { name: "audio", page: "buttons", node: w("audio", { data: SAMPLE_WAV, type: "audio/wav", label: "Next meeting" }), height: 140,
    lua: `local clip = openrouter.speak(ctx, "Your 3pm is in ten minutes")  -- in fetch\n\nui.audio { data = state.clip.data, type = state.clip.type, label = "Next meeting", autoplay = true }` },

  // Titles
  { name: "title", page: "titles", node: w("title", { text: "Charts", sub: "2 of 10" }), width: 400, height: 140 },
  { name: "title", variant: "Centered, with an icon", page: "titles", node: w("title", { text: "Garden", sub: "3 zones · next run 6:00", icon: "sprout", align: "center" }), width: 400, height: 140 },
  { name: "title", variant: "Details beside", page: "titles", node: w("title", { text: "Status", sub: "all systems normal", details: "beside", size: "medium" }), width: 400, height: 120 },
  { name: "title", variant: "Right-aligned, details beside", page: "titles", node: w("title", { text: "Today", sub: "Saturday", align: "right", details: "beside", size: "medium" }), width: 400, height: 120 },

  // Time and layout
  { name: "clock", page: "time", node: w("clock", { tz: "Europe/London", label: "London", date: "ddd, MMM D" }), height: 260 },
  { name: "clock", variant: "Analog", page: "time", node: w("clock", { tz: "Asia/Tokyo", label: "Tokyo", style: "analog" }), height: 300 },
  { name: "clock", variant: "Seconds and 12-hour time", page: "time", node: w("clock", { tz: "America/Los_Angeles", label: "Los Angeles", seconds: true, format: "h:mm:ss a" }), height: 200 },
  { name: "group", page: "time", node: w("group", { direction: "column", gap: 3 }, [
    w("group", { direction: "row", gap: 6 }, [w("stat", { value: "1.12", label: "Load", icon: "activity" }), w("stat", { value: "23d", label: "Uptime", icon: "timer" })]),
    w("line", { points: cpu, unit: "%", min: 0, max: 100 }),
  ]), width: 520 },
];

// What each widget is and its options, shown with its first example.
export const META: Record<string, { summary: string; options: [string, string][] }> = {
  "title": {
    "summary": "A heading for a page or a group of panels, with no panel behind it. Themes can use the same thing as <Title> from @dashboard/layout.",
    "options": [
      ["text, sub", "the title, and details"],
      ["align", "`left` (default), `center` or `right`"],
      ["details", "`below` (default), or `beside`: to the right of a left-aligned title, to the left of a right-aligned one"],
      ["icon", "a Lucide icon before the title"],
      ["size", "`small`, `medium` or `large` (default)"]
    ]
  },
  "stat": {
    "summary": "One figure with a label, a smaller line under it and an optional icon.",
    "options": [
      [
        "value",
        "the figure, as text"
      ],
      [
        "label",
        "what it is"
      ],
      [
        "sub",
        "a smaller line underneath"
      ],
      [
        "icon",
        "a Lucide icon name"
      ]
    ]
  },
  "gauge": {
    "summary": "A half-circle meter. Its color changes as the value passes each stop.",
    "options": [
      [
        "value, max",
        "the reading and the full scale (default 100)"
      ],
      [
        "unit, label, sub, icon",
        "text around the figure"
      ],
      [
        "stops",
        "`{ [75] = \"yellow\", [90] = \"red\" }`: the color from each threshold up; names map to theme tones, anything else is a CSS color"
      ],
      [
        "tone",
        "the color below the first stop (default the theme accent)"
      ],
      [
        "big",
        "`true` to fill the whole panel; without it the gauge is a compact inline meter"
      ]
    ]
  },
  "ticker": {
    "summary": "Rows of label, value and change, colored up or down.",
    "options": [
      [
        "items",
        "`{ label, value, delta?, change? }`; `delta` picks the color, `change` is the text shown (else `delta` as a percent)"
      ]
    ]
  },
  "progress": {
    "summary": "A horizontal bar of value out of max. Stops color it by how full it is, so a balance can turn yellow, then red, as it runs down.",
    "options": [
      [
        "value, max",
        "how full (max defaults to 100)"
      ],
      [
        "label, text",
        "a label, and text on the right"
      ],
      [
        "stops",
        "`{ [0] = \"red\", [10] = \"yellow\", [25] = \"green\" }`: the color from each percent up"
      ],
      [
        "tone",
        "the color without stops (default the theme accent)"
      ]
    ]
  },
  "line": {
    "summary": "A sparkline over a list of numbers, oldest first, with the latest value as text.",
    "options": [
      [
        "points",
        "numbers, oldest first"
      ],
      [
        "label, unit",
        "text for the latest value"
      ],
      [
        "min, max",
        "fix the scale (default: fit the data)"
      ],
      [
        "tone",
        "`accent`, `good`, `warn` or `bad`"
      ],
      [
        "height",
        "in em (default 3.5), or `\"fill\"` for the whole panel"
      ]
    ]
  },
  "bar": {
    "summary": "Vertical bars with labels and values underneath.",
    "options": [
      [
        "items",
        "`{ label, value }`"
      ],
      [
        "label, unit",
        "a caption and the unit after each value"
      ]
    ]
  },
  "donut": {
    "summary": "Parts of a whole, with a legend and a figure in the middle.",
    "options": [
      [
        "items",
        "`{ label, value }`"
      ],
      [
        "center",
        "text in the hole"
      ],
      [
        "label",
        "a caption"
      ]
    ]
  },
  "list": {
    "summary": "Tappable rows. A row's `on_tap` runs one of the module's commands.",
    "options": [
      [
        "(children)",
        "`ui.row`s, as array entries or `children`"
      ],
      [
        "empty",
        "shown when there are no rows"
      ],
      [
        "row: title, meta, badge",
        "the row's text and a count"
      ],
      [
        "row: on_tap",
        "`cmd(\"name\", args)`: runs that command when tapped"
      ]
    ]
  },
  "text": {
    "summary": "Short markdown for digests: bold, italics, inline code, lists and small headings. For anything richer, use ui.markdown.",
    "options": [
      [
        "text",
        "markdown"
      ]
    ]
  },
  "markdown": {
    "summary": "Full markdown for a rich tile: headings, links, task lists, tables, code blocks, quotes and images. Raw HTML is never rendered.",
    "options": [
      [
        "text",
        "markdown, GitHub-flavoured"
      ],
      [
        "links",
        "`false` renders links as plain text, for screens that must never navigate away (default: links open in a new tab)"
      ]
    ]
  },
  "button": {
    "summary": "Runs one of the module's commands when tapped: refresh, run a scene, snooze. Shows the command's error if it fails.",
    "options": [
      [
        "label, icon",
        "text and a Lucide icon"
      ],
      [
        "on_tap",
        "`cmd(\"name\", args)`: the command it runs"
      ]
    ]
  },
  "toggle": {
    "summary": "On or off, iOS style: a switch in a row, a pill to slide (upright like a wall switch), or a Control Center tile. Flips at once; goes back and says why if the command fails.",
    "options": [
      [
        "on",
        "the current state, from the module"
      ],
      [
        "on_change",
        "`cmd(\"name\", args)`: runs with `value = true` or `false` added to args"
      ],
      [
        "label, sub",
        "text"
      ],
      [
        "icon, icon_off",
        "a Lucide icon, and one for while it's off"
      ],
      [
        "style",
        "`switch` (default), `slide` or `tile`"
      ],
      [
        "orientation",
        "for `slide`: `horizontal` (default) or `vertical`"
      ],
      [
        "tone",
        "the on color (default `good`, green)"
      ]
    ]
  },
  "slider": {
    "summary": "A Control Center slider: a fat track that fills as you drag, horizontal or upright. Sends the value once, when let go.",
    "options": [
      [
        "value, min, max, step",
        "the current value (from the module) and its range (default 0 to 100, step 1)"
      ],
      [
        "on_change",
        "`cmd(\"name\", args)`: runs with `value` added, once you let go"
      ],
      [
        "label, unit, icon",
        "text, a unit after the value, and a Lucide icon on the track"
      ],
      [
        "orientation",
        "`horizontal` (default) or `vertical`"
      ]
    ]
  },
  "choice": {
    "summary": "Pick one of a few options: a scene, a mode. The current one is highlighted; tapping another runs the command.",
    "options": [
      [
        "options",
        "strings, or `{ value, label }`"
      ],
      [
        "value",
        "the current option, from the module"
      ],
      [
        "on_change",
        "`cmd(\"name\", args)`: runs with `value` added"
      ],
      [
        "label",
        "a caption"
      ]
    ]
  },
  "image": {
    "summary": "An image, inline as base64 (`data`) or from a URL (`src`). Pairs with openrouter.image() for generated pictures.",
    "options": [
      [
        "data, type",
        "base64 image data and its type (default image/png); a full data: URL works too"
      ],
      [
        "src",
        "an image URL, instead of data"
      ],
      [
        "alt",
        "what the image shows"
      ],
      [
        "fit",
        "`contain` (default) or `cover`"
      ]
    ]
  },
  "audio": {
    "summary": "A clip with a play button, inline as base64 or from a URL. With autoplay, each new clip plays as it arrives: an announcement.",
    "options": [
      [
        "data, type",
        "base64 audio and its type (default audio/mpeg); a full data: URL works too"
      ],
      [
        "src",
        "an audio URL, instead of data"
      ],
      [
        "label",
        "shown beside the button"
      ],
      [
        "autoplay",
        "`true` plays each new clip as it arrives (not the one already there when the page loads)"
      ]
    ]
  },
  "badge": {
    "summary": "A small count or label in a tone.",
    "options": [
      [
        "text",
        "a string or number"
      ],
      [
        "tone",
        "`good`, `warn`, `bad` or `muted`"
      ]
    ]
  },
  "icon": {
    "summary": "A Lucide icon by name, sized in pixels and colored like the text around it.",
    "options": [
      [
        "name",
        "a Lucide icon name from web/src/widgets/icons.tsx"
      ],
      [
        "size",
        "in px (default 20)"
      ]
    ]
  },
  "clock": {
    "summary": "A clock that ticks in the browser, digital or analog, in any time zone.",
    "options": [
      [
        "tz",
        "an IANA time zone"
      ],
      [
        "label",
        "a caption"
      ],
      [
        "style",
        "`digital` or `analog`"
      ],
      [
        "seconds",
        "`true` to show seconds"
      ],
      [
        "format",
        "e.g. `h:mm a`"
      ],
      [
        "date",
        "`true`, or a format like `dddd, MMMM D`"
      ]
    ]
  },
  "group": {
    "summary": "Stacks other widgets in a row or a column. Most views are a group at the top.",
    "options": [
      [
        "direction",
        "`column` (default) or `row`"
      ],
      [
        "gap",
        "space between children, in quarter-rem steps"
      ],
      [
        "(children)",
        "any widgets, as array entries or `children`"
      ]
    ]
  }
};
