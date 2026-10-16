-- Latest quotes from Finnhub.
local function round2(n) return math.floor(n * 100 + 0.5) / 100 end

local function signed(n, fmt)
  local text = string.format(fmt, math.abs(n))
  return (n < 0 and "-" or "+") .. text
end

-- The day's change as text: "+$1.89", "+0.82%", or both.
local function change_text(mode, d, dp)
  local amount, pct = signed(d, "$%.2f"), signed(dp, "%.2f%%")
  if mode == "percent" then return pct end
  if mode == "both" then return amount .. " (" .. pct .. ")" end
  return amount
end

---@type Module
return {
  name = "stocks",
  icon = "chart-line",
  every = "30m",
  config = {
    symbols = { "CRM", "SPY", "VOO" },
    change = "amount",   -- the day's change as "amount" ($), "percent", or "both"
  },

  ---@param ctx Ctx
  fetch = function(ctx)
    local quotes = {}
    for _, symbol in ipairs(ctx.config.symbols) do
      local q = ctx.http.get("https://finnhub.io/api/v1/quote", {
        query = {
          symbol = symbol,
          token = ctx.env("FINNHUB_API_KEY"),
        }
      })
      local d, dp = q.d or 0, q.dp or 0
      quotes[#quotes + 1] = {
        label = symbol,
        value = string.format("%.2f", q.c),
        delta = round2(d),
        change = change_text(ctx.config.change, d, dp),
      }
    end
    return { quotes = quotes }
  end,

  ---@param state table
  view = function(state)
    return ui.ticker { items = state.quotes }
  end,
}
