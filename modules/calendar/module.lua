-- Upcoming events from one or more iCalendar feeds (GOOGLE_CALENDAR_ICS_URL, comma-separated).
---@type Module
return {
  name = "calendar",
  icon = "calendar",
  every = "5m",
  title = "Calendar",
  config = {
    days = 3,
    past = "dim",   -- "dim" fades events that have ended; "hide" drops them
  },

  ---@param ctx Ctx
  fetch = function(ctx)
    local from = ctx.today()
    local events = json.array({})
    local feeds, failed = 0, 0
    for url in string.gmatch(ctx.env("GOOGLE_CALENDAR_ICS_URL"), "[^,]+") do
      url = url:match("^%s*(.-)%s*$")
      if url ~= "" then
        feeds = feeds + 1
        -- One dead feed must not blank the others: skip it, count it, log it.
        local ok, result = pcall(function()
          -- One day extra: the screen decides what "today" is from its clock, and a state fetched
          -- just before midnight must still cover the last column.
          return ctx.ical.events(ctx.http.get(url, { timeout = 20 }), { from = from, days = ctx.config.days + 1 })
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
