-- Events pushed in from anywhere (a work calendar the dashboard can't read, a deploy, a train), shown
-- by ui.agenda: the next one counting down, the few after it as calendar rows. Push a whole day at once;
-- the screen rolls to the next event as each ends. Each push names its source and replaces only that
-- source's events; `"replace": true` makes a push the whole agenda. Body:
--   { "source": "work", "events": [ { "title": "Standup", "at": "2026-10-19T17:00:00-04:00", "end": "...", "icon": "users" } ] }
-- `at` and `end` are ISO 8601 (an offset or Z; without one, the host time zone) or unix seconds.
-- One panel per instance: <Slot module="upcoming" instance="work" /> takes pushes at /hooks/upcoming:work/push.

-- How long an event with no end stays on screen after it starts.
local LINGER = 10 * 60

--- Unix seconds from unix seconds or an ISO 8601 time; nil if it's neither.
local function seconds(ctx, t)
  if type(t) == "number" then return math.floor(t) end
  if type(t) ~= "string" then return nil end
  local date, clock, rest = t:match("^(%d%d%d%d%-%d%d%-%d%d)[T ](%d%d:%d%d)(.*)$")
  if not date then return nil end
  local secs, zone = rest:match("^(:%d%d)(.*)$")
  zone = zone or rest
  secs = secs or ":00"
  zone = zone:gsub("^%.%d+", "")  -- fractional seconds
  local wall = date .. "T" .. clock .. secs
  if zone == "" then return ctx.instant(wall).epoch end
  local base = ctx.instant(wall, "UTC").epoch
  if zone == "Z" then return base end
  local sign, hh, mm = zone:match("^([+-])(%d%d):?(%d%d)$")
  if not sign then return nil end
  local offset = (tonumber(hh) * 60 + tonumber(mm)) * 60
  return sign == "+" and base - offset or base + offset
end

local function over(e, now)
  return (e["end"] or (e.at + LINGER)) <= now
end

---@type Module
return {
  name = "upcoming",
  icon = "calendar-clock",
  title = "Up next",
  config = {
    count = 4,   -- events shown: the next one large, the rest as rows
  },

  hooks = {
    push = {
      description = "Set one source's events (e.g. a work schedule). Send all of that source's events each time: "
        .. "its events not sent disappear; other sources are kept, unless `replace` is true. An empty list clears the source.",
      auth = { token = "HOOKS_TOKEN" },
      schema = {
        type = "object",
        required = { "events" },
        properties = {
          source = { type = "string", description = "Who is sending, e.g. work. Default: \"default\"" },
          replace = { type = "boolean", description = "This push is the whole agenda: drop every other source's events too" },
          events = {
            type = "array",
            items = {
              type = "object",
              required = { "title", "at" },
              properties = {
                title = { type = "string" },
                at = { description = "Start: ISO 8601 (with an offset or Z) or unix seconds" },
                ["end"] = { description = "End, same forms; optional" },
                icon = { type = "string", description = "A Lucide icon name, e.g. users, video, phone" },
                sub = { type = "string", description = "One short line, e.g. a room or who with" },
              },
            },
          },
        },
      },
      example = {
        source = "work",
        events = {
          { title = "Standup", at = "2026-10-19T09:30:00-04:00", ["end"] = "2026-10-19T09:45:00-04:00", icon = "users" },
          { title = "Design review", at = "2026-10-19T14:00:00-04:00", ["end"] = "2026-10-19T15:00:00-04:00", sub = "Room 4" },
        },
      },
      ---@param ctx Ctx
      handle = function(ctx, req)
        local body = req.body
        if type(body) ~= "table" or type(body.events) ~= "table" then
          error("body must be { source?, events = [ { title, at, end? } ] }")
        end
        local source = type(body.source) == "string" and body.source ~= "" and body.source or "default"
        local now = ctx.now()
        local events = json.array({})
        if body.replace ~= true then
          for _, e in ipairs((ctx.state and ctx.state.events) or {}) do
            if e.source ~= source and not over(e, now) then events[#events + 1] = e end
          end
        end
        for i, e in ipairs(body.events) do
          if type(e) ~= "table" or type(e.title) ~= "string" then error("event " .. i .. " needs a title") end
          local at = seconds(ctx, e.at)
          -- Errors name the event by position only: titles may be private, and errors are logged.
          if not at then error("event " .. i .. " needs `at`: ISO 8601 or unix seconds") end
          local ev = {
            source = source,
            title = e.title,
            at = at,
            ["end"] = e["end"] ~= nil and seconds(ctx, e["end"]) or nil,
            icon = type(e.icon) == "string" and e.icon or nil,
            sub = type(e.sub) == "string" and e.sub or nil,
          }
          if not over(ev, now) then events[#events + 1] = ev end
        end
        table.sort(events, function(a, b)
          if a.at ~= b.at then return a.at < b.at end
          return a.title < b.title
        end)
        return { events = events, pushed_at = now }
      end,
    },
  },

  view = function(state, config)
    return ui.agenda { events = state.events, count = config.count }
  end,
}
