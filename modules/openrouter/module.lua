-- OpenRouter spend: the credit balance left, as a bar that turns yellow then red as it runs down; what's
-- been spent today, this week and this month; and the API key's own limit when it has one.
-- Uses lib/openrouter.lua and OPENROUTER_API_KEY.
--
-- With OPENROUTER_MANAGEMENT_KEY set as well (a read-only management key from OpenRouter's settings), it
-- also lists the last 30 days' spend by model.
local openrouter = require("openrouter")

local function money(n)
  n = tonumber(n) or 0
  if n > 0 and n < 0.005 then return "<$0.01" end
  return string.format("$%.2f", n)
end

-- Dollar amounts to a millionth, so sums like 0.10 + 0.05 stay 0.15.
local function round(n) return math.floor(n * 1e6 + 0.5) / 1e6 end

local function has_setting(ctx, name)
  local ok, value = pcall(ctx.env, name)
  return ok and value ~= ""
end

---@type Module
return {
  name = "openrouter",
  icon = "sparkles",
  title = "OpenRouter",
  every = "5m",
  config = {
    -- The balance bar's colors, by percent of credit left: red below 10%, yellow below 25%.
    stops = { [0] = "red", [10] = "yellow", [25] = "green" },
  },

  ---@param ctx Ctx
  fetch = function(ctx)
    local credits = openrouter.get(ctx, "/credits")
    local key = openrouter.get(ctx, "/key")
    local total, spent = tonumber(credits.total_credits) or 0, tonumber(credits.total_usage) or 0

    local models = nil
    if has_setting(ctx, "OPENROUTER_MANAGEMENT_KEY") then
      local by_model = {}
      for _, row in ipairs(openrouter.get(ctx, "/activity", { key = "OPENROUTER_MANAGEMENT_KEY" }) or {}) do
        local m = by_model[row.model] or { model = row.model, usage = 0, requests = 0 }
        m.usage = m.usage + (tonumber(row.usage) or 0)
        m.requests = m.requests + (tonumber(row.requests) or 0)
        by_model[row.model] = m
      end
      models = {}
      for _, m in pairs(by_model) do m.usage = round(m.usage) models[#models + 1] = m end
      table.sort(models, function(a, b) return a.usage > b.usage end)
      while #models > 5 do table.remove(models) end
      models = json.array(models)
    end

    return {
      credits = total,
      spent = spent,
      left = math.max(0, total - spent),
      today = tonumber(key.usage_daily) or 0,
      week = tonumber(key.usage_weekly) or 0,
      month = tonumber(key.usage_monthly) or 0,
      limit = tonumber(key.limit),
      limit_left = tonumber(key.limit_remaining),
      limit_reset = key.limit_reset,
      models = models,
    }
  end,

  ---@param state table
  ---@param config table
  view = function(state, config)
    local rows = {
      ui.progress {
        value = state.left, max = state.credits, label = "Balance",
        text = money(state.left) .. " left of " .. money(state.credits), stops = config.stops,
      },
      ui.list {
        ui.row { title = "Today", meta = money(state.today) },
        ui.row { title = "This week", meta = money(state.week) },
        ui.row { title = "This month", meta = money(state.month) },
      },
    }
    if state.models and #state.models > 0 then
      local list = {}
      for _, m in ipairs(state.models) do
        list[#list + 1] = ui.row { title = (m.model:gsub("^[^/]+/", "")), meta = string.format("%d requests", m.requests), badge = money(m.usage) }
      end
      rows[#rows + 1] = ui.list(list)
    end
    if state.limit then
      local period = ({ daily = " today", weekly = " this week", monthly = " this month" })[state.limit_reset] or ""
      rows[#rows + 1] = ui.text { text = "Key limit: " .. money(state.limit_left) .. " of " .. money(state.limit) .. " left" .. period }
    end
    return ui.group { direction = "column", gap = 4, table.unpack(rows) }
  end,
}
