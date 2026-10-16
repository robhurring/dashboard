-- The dashboard's own Redis: memory against its limit, key count, version.
---@type Module
return {
  name = "redis",
  icon = "redis",
  every = "10s",
  config = { show = "all" },   -- "all" (gauge plus keys), or "memory" (the gauge filling its panel, keys beneath)
  title = "Redis {{state.version}}",
  ---@param ctx Ctx
  fetch = function(ctx)
    local i = ctx.redis.info()
    local pct = i.max_mb > 0 and (i.used_mb / i.max_mb * 100) or 0
    local up = i.uptime_secs or 0
    return {
      mem = string.format("%.1f / %.0f MB", i.used_mb, i.max_mb),
      pct = pct,
      keys = tostring(i.keys),
      version = i.version,
      uptime = up >= 86400 and string.format("%dd %dh", up // 86400, up % 86400 // 3600) or string.format("%dh %dm", up // 3600, up % 3600 // 60),
    }
  end,
  ---@param state table
  ---@param config table
  view = function(state, config)
    if config.show == "memory" then
      return ui.gauge { label = "Redis", icon = "redis", value = state.pct, unit = "%", sub = state.mem .. " · " .. state.keys .. " keys", tone = "purple", stops = { [80] = "yellow", [95] = "red" }, big = true }
    end
    return ui.group { direction = "row", gap = 4,
      ui.gauge { label = "Redis", icon = "redis", value = state.pct, unit = "%", sub = state.mem, tone = "purple", stops = { [80] = "yellow", [95] = "red" } },
      ui.stat { label = "Keys", value = state.keys, icon = "database" },
    }
  end,
}
