# Writing a module

A module is a folder under `modules/` with a `module.lua`, and optionally a `ui/index.tsx` for a
custom React view. The folder name is the module name. The server loads every module at start
and, in development, reloads one the moment you save it.

`lua/dashboard.d.lua` has type annotations for everything below. Point your editor's Lua
language server at it and `---@type Module` gives you completion.

## The shape

```lua
---@type Module
return {
  name = "weather",                 -- must match the folder
  icon = "cloud-sun",               -- header icon: a Lucide name
  title = "Weather: {{config.zip}}",-- header title, a template over config, state and status
  every = "10m",                    -- or cron = "*/30 9-16 * * 1-5" (in the TZ env var's zone)
  config = {                        -- defaults; a <Slot> or application.lua can override any of them
    zip = required,                 -- no default: every instance must pass it
    units = "imperial",
  },
  fetch = function(ctx) ... end,    -- returns the new state (a plain table), or nil for "no change"
  view = function(state, config) ... end,  -- a widget tree; or `component = "Weather"` instead
}
```

An **instance** is a module plus config. `<Slot module="weather" instance="home" zip="10001" />`
creates the instance `weather:home`; two slots with different instance names get two independent
copies with their own state and schedule.

## Fetching

`fetch(ctx)` runs on the schedule, but only while some screen shows the instance (or the slot says
`poll="always"`). Whatever it returns becomes the state and is pushed to every screen. If it
raises, the old state stays on screen with an error badge, and the server retries with backoff.

What `ctx` offers:

| | |
|---|---|
| `ctx.config` | the instance's config: module defaults overlaid with what the slot passed |
| `ctx.state` | the current state (nil before the first fetch) |
| `ctx.http.get(url, opts)`, `ctx.http.post(url, opts)` | `opts`: `query`, `headers`, `json`, `body`, `timeout`; returns decoded JSON, or text |
| `ctx.env(name)` | an environment variable, for API keys; raises if unset |
| `ctx.now()`, `ctx.today()` | unix seconds, and `YYYY-MM-DD` in the host zone |
| `ctx.ical.events(ics, { days = 3 })` | iCalendar text to events, recurrences expanded |
| `ctx.sys.stats()`, `ctx.redis.info()` | host CPU, memory, load and uptime; Redis usage |
| `ctx.refresh()` | run `fetch` again right after this returns |
| `ctx.log(level, msg)` | to the server log |

Keep upstream URLs in the module and secrets in the environment. Config can be set by any screen,
so it should never decide where requests go or carry a key.

## Drawing with widgets

`view(state, config)` returns a tree of built-in widgets. The browser renders it inside the
module's frame, so a module with a `view` needs no frontend code at all.

| Widget | For |
|---|---|
| `ui.stat { value, label, sub, icon }` | one big number |
| `ui.gauge { value, max, unit, label, sub, icon, stops, big }` | a half-circle meter; `stops = { [75] = "yellow", [90] = "red" }` |
| `ui.ticker { items }` | label / value / change rows, colored by `delta` |
| `ui.line { points, min, max, unit, height }` | a sparkline, oldest point first |
| `ui.bar { items }`, `ui.donut { items, center }` | small charts |
| `ui.list { ... }` and `ui.row { title, meta, badge, on_tap }` | tappable lists |
| `ui.text { text }`, `ui.badge { text, tone }`, `ui.icon { name }` | text bits |
| `ui.clock { tz, style, format, date }` | a clock that ticks in the browser |
| `ui.group { direction, gap, ... }` | stack any of the above |

## Drawing with a component

When widgets aren't enough, set `component = "Weather"` and export a React component with that
name from `modules/weather/ui/index.tsx`. It receives:

```ts
type CustomProps = {
  state: JsonValue | null;          // what fetch returned
  config: Record<string, JsonValue>;
  status: Status | null;            // ok, error, fetched_at, ...
  send: (action: string, args?: JsonValue) => Promise<void>;  // runs a command (below)
  title: string;
  density: "compact" | "normal" | "large";
};
```

Components are found at build time and loaded only when a screen shows them. A component owns
its whole slot, header included; a slot can ask for the standard frame with `chrome="full"`.

## Commands

Commands let the screen act on a module: the Todoist board's drag and Done buttons are commands.

```lua
commands = {
  complete = function(ctx, args)
    ctx.http.post(API .. "/tasks/" .. args.id .. "/close", { headers = auth(ctx) })
    ctx.refresh()
  end,
},
```

From a widget, `on_tap = cmd("complete", { id = task.id })`. From a component, `send("complete",
{ id })`. The promise resolves when the command finishes and rejects with its error.

## Hooks

A module can also take data pushed from outside instead of, or as well as, fetching it. See
[hooks.md](hooks.md).
