-- A wall clock. The widget ticks in the browser; the server only passes the settings through.
---@type Module
return {
  name = "clock",
  icon = "clock",
  every = "1d",
  config = {
    tz = "America/New_York",
    label = "",
    seconds = false,
    style = "digital",   -- or "analog"
    format = "",         -- time tokens, e.g. "h:mm a"; empty = "HH:mm" (plus ":ss" with seconds)
    date = false,        -- true for "ddd, MMM D", or a format like "dddd, MMMM D"
  },
  ---@param ctx Ctx
  fetch = function(ctx)
    local c = ctx.config
    return { tz = c.tz, label = c.label, seconds = c.seconds, style = c.style, format = c.format, date = c.date }
  end,
  ---@param state table
  view = function(state)
    return ui.clock { tz = state.tz, label = state.label, seconds = state.seconds, style = state.style, format = state.format, date = state.date }
  end,
}
