-- Upcoming events from one or more iCalendar feeds. Each panel picks its feeds by name:
--   <Slot module="calendar" instance="family" feeds="family" />     reads CALENDAR_FAMILY
--   <Slot module="calendar" instance="work" feeds="work,oncall" />  reads CALENDAR_WORK and CALENDAR_ONCALL
-- With no feeds, it reads GOOGLE_CALENDAR_ICS_URL. Each variable holds one or more ICS URLs, comma-separated.
-- The URLs stay in the environment: config is visible to every screen, and these addresses are secrets.
-- Parsing and recurrence expansion live in ics.lua, next to this file.
local ics = require("ics")

-- Every URL this panel reads, from the variables its feed names point at. A name is letters, digits and
-- `_` only, so a screen can choose among calendar variables but never read any other setting.
local function feed_urls(ctx)
  local names = ctx.config.feeds or ""
  if names:match("^%s*$") then return ctx.env("GOOGLE_CALENDAR_ICS_URL") end
  local urls = {}
  for name in string.gmatch(names, "[^,]+") do
    name = name:match("^%s*(.-)%s*$")
    if not name:match("^[%w_]+$") then error("feed names are letters, digits and _, got " .. name, 0) end
    urls[#urls + 1] = ctx.env("CALENDAR_" .. name:upper())
  end
  return table.concat(urls, ",")
end

---@type Module
return {
  name = "calendar",
  icon = "calendar",
  every = "5m",
  title = "Calendar",
  config = {
    days = 3,
    past = "dim",   -- "dim" fades events that have ended; "hide" drops them
    feeds = "",     -- feed names, comma-separated: "work" reads CALENDAR_WORK. Empty: GOOGLE_CALENDAR_ICS_URL
  },

  ---@param ctx Ctx
  fetch = function(ctx)
    local from = ctx.today()
    local events = json.array({})
    local feeds, failed = 0, 0
    for url in string.gmatch(feed_urls(ctx), "[^,]+") do
      url = url:match("^%s*(.-)%s*$")
      if url ~= "" then
        feeds = feeds + 1
        -- One dead feed must not blank the others: skip it, count it, log it.
        local ok, result = pcall(function()
          -- One day extra: the screen decides what "today" is from its clock, and a state fetched
          -- just before midnight must still cover the last column.
          return ics.events(ctx.http.get(url, { timeout = 20 }), { from = from, days = ctx.config.days + 1 }, ctx)
        end)
        if ok then
          for _, e in ipairs(result) do events[#events + 1] = e end
        else
          failed = failed + 1
          ctx.log("warn", "calendar feed skipped: " .. tostring(result))
        end
      end
    end
    if feeds > 0 and failed == feeds then error("every calendar feed failed") end
    table.sort(events, function(a, b)
      if a.start ~= b.start then return a.start < b.start end
      return a.title < b.title
    end)
    return { from = from, days = ctx.config.days, events = events, failed = failed, fetched_at = ctx.now() }
  end,

  -- Rendered by ui/index.tsx: days as columns, Today / Tomorrow / weekday.
  component = "Calendar",
}
