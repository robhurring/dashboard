-- CPU, memory, load and uptime of the machine running the dashboard server.
local function fmt_uptime(secs)
  local d = math.floor(secs / 86400)
  local h = math.floor(secs % 86400 / 3600)
  local m = math.floor(secs % 3600 / 60)
  if d > 0 then return string.format("%dd %dh", d, h) end
  return string.format("%dh %dm", h, m)
end

---@type Module
return {
  name = "system",
  icon = "server",
  every = "5s",   -- the host samples CPU every 5 s; the gauges keep up with it
  title = "Server",
  config = { show = "all" },   -- "all", or one part: "cpu", "memory", "history" (the hour's CPU with load and uptime)
  ---@param ctx Ctx
  fetch = function(ctx)
    local s = ctx.sys.stats()
    -- The sparkline keeps the last hour at one point per 30 s, however often the gauges refresh.
    local now = ctx.now()
    local history = (ctx.state and ctx.state.cpu_history) or {}
    local charted_at = (ctx.state and ctx.state.charted_at) or 0
    if now - charted_at >= 30 then
      history[#history + 1] = math.floor(s.cpu_pct + 0.5)
      while #history > 120 do table.remove(history, 1) end
      charted_at = now
    end
    return {
      cpu_pct = s.cpu_pct,
      cpu_history = json.array(history),
      charted_at = charted_at,
      mem_pct = s.mem_total_mb > 0 and (s.mem_used_mb / s.mem_total_mb * 100) or 0,
      mem = string.format("%.1f / %.1f GB", s.mem_used_mb / 1024, s.mem_total_mb / 1024),
      load = string.format("%.2f", s.load1),
      load_sub = string.format("5m %.2f · 15m %.2f", s.load5, s.load15),
      uptime = fmt_uptime(s.uptime_secs),
    }
  end,
  ---@param state table
  ---@param config table
  view = function(state, config)
    local show = config.show
    if show == "cpu" then
      return ui.gauge { label = "CPU", icon = "cpu", value = state.cpu_pct, unit = "%", sub = "of all cores", stops = { [70] = "yellow", [90] = "red" }, big = true }
    elseif show == "memory" then
      return ui.gauge { label = "Memory", icon = "memory-stick", value = state.mem_pct, unit = "%", sub = state.mem, stops = { [75] = "yellow", [90] = "red" }, big = true }
    elseif show == "history" then
      return ui.group { direction = "column", gap = 4,
        ui.line { points = state.cpu_history, unit = "%", min = 0, max = 100, height = "fill" },
        ui.group { direction = "row", gap = 6,
          ui.stat { label = "Load", value = state.load, sub = state.load_sub, icon = "activity" },
          ui.stat { label = "Uptime", value = state.uptime, icon = "timer" },
        },
      }
    end
    return ui.group { direction = "column", gap = 2,
      ui.group { direction = "row", gap = 4,
        ui.gauge { label = "CPU", icon = "cpu", value = state.cpu_pct, unit = "%", stops = { [70] = "yellow", [90] = "red" } },
        ui.gauge { label = "Memory", icon = "memory-stick", value = state.mem_pct, unit = "%", sub = state.mem, stops = { [75] = "yellow", [90] = "red" } },
      },
      ui.line { label = "CPU · last hour", points = state.cpu_history, unit = "%", min = 0, max = 100 },
      ui.group { direction = "row", gap = 4,
        ui.stat { label = "Load", value = state.load, sub = state.load_sub, icon = "activity" },
        ui.stat { label = "Uptime", value = state.uptime, icon = "timer" },
      },
    }
  end,
}
