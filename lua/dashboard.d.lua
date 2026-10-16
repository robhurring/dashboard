---@meta
-- Type definitions for the dashboard host API, read by the Lua language server
-- (sumneko / lua-language-server) via .luarc.json. Nothing here runs at runtime.

---@alias json table|string|number|boolean|nil

--- A widget node returned by `view`.
---@class Widget
---@field type string
---@field props table
---@field children Widget[]|nil

--- An action prop: tapping sends this command to the owning instance.
---@class Action
---@field command string
---@field args table

---@class ui
ui = {}

--- Big number with a label: `ui.stat { value = "58°", label = "Clouds", sub = "feels 60°", icon = "cloud-sun" }`
---@param props { value?: string, label?: string, sub?: string, icon?: string }
---@return Widget
function ui.stat(props) end

--- Rows of label / value / change: `ui.ticker { items = { { label = "AAPL", value = "231.40", delta = 1.89, change = "+$1.89" } } }`
--- `delta` sets the color (up green, down red); `change` is the text shown, else delta as a percent.
---@param props { items: { label: string, value: string, delta?: number, change?: string }[] }
---@return Widget
function ui.ticker(props) end

--- A list of rows. Children go in `children` or as array entries; `empty` shows when there are none.
---@param props { empty?: string, children?: Widget[], [integer]: Widget }
---@return Widget
function ui.list(props) end

--- One row in a list. `on_tap` takes `cmd(...)`.
---@param props { title?: string, meta?: string, badge?: number|string, on_tap?: Action }
---@return Widget
function ui.row(props) end

--- Restricted markdown text.
---@param props { text: string }
---@return Widget
function ui.text(props) end

---@param props { text: string|number, tone?: "good"|"bad"|"warn"|"muted" }
---@return Widget
function ui.badge(props) end

--- A Lucide icon by name, e.g. "cloud-sun", "trending-up".
---@param props { name: string, size?: number }
---@return Widget
function ui.icon(props) end

--- A vertical or horizontal stack of widgets.
---@param props { direction?: "row"|"column", gap?: number, children?: Widget[], [integer]: Widget }
---@return Widget
function ui.group(props) end

--- A wall clock that ticks in the browser.
---@param props { tz?: string, label?: string, seconds?: boolean, style?: "digital"|"analog", format?: string, date?: boolean|string }
--- `format` tokens: HH H hh h mm ss A a and date tokens YYYY MM M DD D dddd ddd MMMM MMM, [literal] in brackets.
---@return Widget
function ui.clock(props) end

--- A half-circle gauge: `value` out of `max` (default 100). Its color is `tone` (default the theme accent) until the
--- value reaches a stop: `stops = { [75] = "yellow", [90] = "red" }`; names map to theme tones, anything else is a CSS color.
--- `warn_at` / `bad_at` are shorthand for two stops.
---@param props { value: number, max?: number, unit?: string, label?: string, sub?: string, icon?: string, stops?: table<number, string>, warn_at?: number, bad_at?: number, tone?: string, big?: boolean }   -- big: fill the card; icon: a Lucide name or "redis"
---@return Widget
function ui.gauge(props) end

--- A sparkline over a plain list of numbers, oldest first; the latest value is shown as text.
---@param props { points: number[], label?: string, unit?: string, min?: number, max?: number, tone?: "accent"|"good"|"warn"|"bad", height?: number|"fill" }   -- height in em (default 3.5) or "fill" the panel
---@return Widget
function ui.line(props) end

--- Vertical bars, one per item, with labels and values underneath.
---@param props { items: { label: string, value: number }[], label?: string, unit?: string }
---@return Widget
function ui.bar(props) end

--- A donut with a legend and an optional figure in the middle.
---@param props { items: { label: string, value: number }[], center?: string|number, label?: string }
---@return Widget
function ui.donut(props) end

--- Build an action prop: `on_tap = cmd("dismiss", { name = "incident" })`.
---@param action string
---@param args? table
---@return Action
function cmd(action, args) end

--- Marks a config key as having no default: `config = { project = required }`. An instance that
--- does not pass it fails to load with a message naming the key.
---@type any
required = nil

---@class json_lib
json = {}
---@param value json
---@return string
function json.encode(value) end
---@param text string
---@return json
function json.decode(text) end
--- Marks a table as a list so an empty one encodes as `[]`, not `{}`.
---@generic T: table
---@param t T
---@return T
function json.array(t) end

--- Options for `ctx.http.get` / `ctx.http.post`.
---@class HttpOpts
---@field query table<string, string|number|boolean>|nil
---@field headers table<string, string>|nil
---@field json json|nil        -- request body, JSON-encoded
---@field body string|nil      -- raw request body
---@field timeout number|nil   -- seconds

---@class Http
local Http = {}
--- GET. JSON responses are decoded to tables; other bodies come back as strings. Non-2xx raises.
---@param url string
---@param opts? HttpOpts
---@return any
function Http.get(url, opts) end
---@param url string
---@param opts? HttpOpts
---@return any
function Http.post(url, opts) end

---@class SysStats
---@field cpu_pct number
---@field mem_used_mb integer
---@field mem_total_mb integer
---@field load1 number
---@field load5 number
---@field load15 number
---@field uptime_secs integer

---@class Sys
local Sys = {}
--- CPU, memory, load and uptime of the machine running the server, sampled every 5 seconds.
---@return SysStats
function Sys.stats() end

---@class RedisInfo
---@field used_mb number
---@field max_mb number
---@field keys integer
---@field version string
---@field uptime_secs integer

---@class Redis
local Redis = {}
--- The dashboard's own Redis. Raises when the host is not using Redis.
---@return RedisInfo
function Redis.info() end

--- The context passed to `fetch`, hook handlers and commands.
---@class Ctx
---@field state any          -- this instance's current state (nil before the first fetch)
---@field config table       -- module defaults overlaid with instance config
---@field http Http
---@field sys Sys
---@field redis Redis
---@field ical Ical
local Ctx = {}
--- An environment variable's value: system-wide static settings such as API keys. Raises if unset.
--- Keep upstream URLs hardcoded: `config` can be set by any screen.
---@param name string
---@return string
function Ctx.env(name) end
--- Ask the host to run `fetch` after this call returns.
function Ctx.refresh() end
---@return integer  unix seconds
function Ctx.now() end
--- Today's calendar date, "YYYY-MM-DD", in the host time zone (the TZ environment variable).
---@return string
function Ctx.today() end
---@param level "debug"|"info"|"warn"|"error"
---@param msg string
function Ctx.log(level, msg) end

---@class IcalEvent
---@field title string
---@field start string      -- RFC 3339 in the host zone, or YYYY-MM-DD when all_day
---@field end string
---@field all_day boolean
---@field calendar string   -- the calendar's X-WR-CALNAME

---@class Ical
local Ical = {}
--- Every occurrence in [from, to) of an iCalendar text, recurrences expanded, in the host zone. Raises on bad input.
--- `from` defaults to today; give `to` (exclusive) or `days`.
---@param ics string
---@param window { from?: string, to?: string, days?: integer }   -- YYYY-MM-DD
---@return IcalEvent[]
function Ical.events(ics, window) end

--- What `module.lua` returns.
--- A request delivered to a hook.
---@class HookRequest
---@field body any                          -- decoded JSON, or the raw text if the body is not JSON
---@field headers table<string, string>     -- an allow-list: user-agent, content-type, x-event, x-github-event, x-request-id

--- How a hook is authenticated, checked by the host before `handle` runs.
---@alias HookAuth
---| { token: string }   -- env var holding a shared token; callers send "Authorization: Bearer <token>" or "X-Hook-Token: <token>". Unset = open (local dev)
---| { hmac: "sha256", header: string, secret: string, encoding?: "hex"|"base64" }   -- secret: an env var name
---| { public: true }

--- An inbound webhook. Everything except `handle` is published at GET /hooks/<instance>/<name>.
---@class Hook
---@field auth HookAuth
---@field handle fun(ctx: Ctx, req: HookRequest): table|nil   -- return the new state, or nil for no change
---@field description string|nil
---@field schema table|nil                  -- JSON Schema of the body
---@field example table|nil                 -- a body that the hook accepts

---@class Module
---@field name string                       -- must match the folder name
---@field every string|nil                  -- "30m", "1h" (or use `cron`)
---@field cron string|nil                   -- "*/30 9-16 * * 1-5", evaluated in the TZ environment variable's zone (default UTC)
---@field stale_after string|nil            -- default: twice `every`
---@field config table|nil                  -- overridable defaults; a key set to `required` has none and every instance must pass it
---@field fetch (fun(ctx: Ctx): table|nil)|nil   -- return the new state, or nil for no change; omit for push-only modules
---@field view (fun(state: table, config: table): Widget)|nil   -- widget tree from state (and the instance config); or set `component` instead
---@field component string|nil              -- name of an export of ui/index.tsx that renders the state; or set `view` instead
---@field title string|nil                  -- default frame title template, e.g. "Weather: {{config.zip}}"
---@field icon string|nil                   -- default header icon: a Lucide name ("cloud-sun") or "redis"
---@field commands table<string, fun(ctx: Ctx, args: table): table|nil>|nil
---@field hooks table<string, Hook>|nil      -- inbound webhooks at POST /hooks/<instance>/<name>
