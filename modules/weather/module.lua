-- Current conditions for one place, from OpenWeather.
local GROUP_ICONS = {
  [2] = "cloud-lightning",
  [3] = "cloud-drizzle",
  [5] = "cloud-rain",
  [6] = "cloud-snow",
  [7] =
  "cloud-fog"
}

-- OpenWeather condition codes: https://openweathermap.org/weather-conditions
local function icon_for(code)
  if code == 800 then return "sun" end
  if code == 801 or code == 802 then return "cloud-sun" end
  if code == 803 or code == 804 then return "cloud" end
  return GROUP_ICONS[math.floor(code / 100)] or "cloud"
end

local function round(n) return math.floor(n + 0.5) end

---@type Module
return {
  name = "weather",
  icon = "cloud-sun",
  every = "1h",
  title = "Weather: {{state.place}} ({{config.zip}})",
  config = { zip = "07110", country = "us", units = "imperial" },

  ---@param ctx Ctx
  fetch = function(ctx)
    local c = ctx.config
    local r = ctx.http.get("https://api.openweathermap.org/data/2.5/weather", {
      query = {
        zip = c.zip .. "," .. c.country,
        units = c.units,
        appid = ctx.env("OPENWEATHERMAP_API_KEY"),
      }
    })
    -- The next five 3-hour slots, from the free 5-day forecast.
    local f = ctx.http.get("https://api.openweathermap.org/data/2.5/forecast", {
      query = { zip = c.zip .. "," .. c.country, units = c.units, cnt = 5, appid = ctx.env("OPENWEATHERMAP_API_KEY") },
    })
    local forecast = json.array({})
    for _, slot in ipairs(f.list or {}) do
      forecast[#forecast + 1] = {
        at = slot.dt,
        temp = round(slot.main.temp),
        icon = icon_for(slot.weather[1].id),
        pop = round((slot.pop or 0) * 100),
      }
    end
    return {
      temp = round(r.main.temp),
      feels = round(r.main.feels_like),
      hi = round(r.main.temp_max),
      lo = round(r.main.temp_min),
      humidity = round(r.main.humidity),
      wind = round(r.wind and r.wind.speed or 0),
      sky = r.weather[1].main,
      description = r.weather[1].description,
      icon = icon_for(r.weather[1].id),
      place = r.name,
      -- Seconds east of UTC at that place, so the screen shows its local times.
      tz_offset = r.timezone or 0,
      sunrise = r.sys and r.sys.sunrise or nil,
      sunset = r.sys and r.sys.sunset or nil,
      forecast = forecast,
    }
  end,

  -- Rendered by the Weather component in ui/index.tsx from the state above.
  component = "Weather",
}
