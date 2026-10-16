-- iCalendar (RFC 5545) feeds to the event occurrences in a date window, for the calendar module.
--
-- Covers what Google Calendar's ICS export uses: all-day and timed events (UTC, TZID or floating),
-- DTEND or DURATION, RRULE with FREQ DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL, BYDAY
-- (with ordinals like 2TU or -1FR), BYMONTHDAY and BYMONTH, EXDATE, and RECURRENCE-ID overrides
-- (moved or cancelled occurrences). A rule outside that set drops only its own event.
--
-- Recurrences are expanded on the event's own wall clock, so a 9:00 meeting stays at 9:00 in its
-- zone across daylight-saving changes; ctx.instant turns each occurrence into a moment in the host zone.

local M = {}

local floor = math.floor

-- Dates as day numbers (days since 1970-01-01). Howard Hinnant's civil-date algorithms.
local function days_from_civil(y, m, d)
  if m <= 2 then y = y - 1 end
  local era = floor(y / 400)
  local yoe = y - era * 400
  local mp = m > 2 and m - 3 or m + 9
  local doy = floor((153 * mp + 2) / 5) + d - 1
  local doe = yoe * 365 + floor(yoe / 4) - floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
end

local function civil_from_days(z)
  z = z + 719468
  local era = floor(z / 146097)
  local doe = z - era * 146097
  local yoe = floor((doe - floor(doe / 1460) + floor(doe / 36524) - floor(doe / 146096)) / 365)
  local doy = doe - (365 * yoe + floor(yoe / 4) - floor(yoe / 100))
  local mp = floor((5 * doy + 2) / 153)
  local d = doy - floor((153 * mp + 2) / 5) + 1
  local m = mp < 10 and mp + 3 or mp - 9
  local y = yoe + era * 400 + (m <= 2 and 1 or 0)
  return y, m, d
end

local function days_in_month(y, m)
  local ny, nm = y, m + 1
  if nm > 12 then ny, nm = y + 1, 1 end
  return days_from_civil(ny, nm, 1) - days_from_civil(y, m, 1)
end

-- Monday = 0 ... Sunday = 6. 1970-01-01 was a Thursday.
local function weekday(day) return (day + 3) % 7 end
local WEEKDAYS = { MO = 0, TU = 1, WE = 2, TH = 3, FR = 4, SA = 5, SU = 6 }

local function ymd(day)
  local y, m, d = civil_from_days(day)
  return string.format("%04d-%02d-%02d", y, m, d)
end

local function wall(day, secs)
  local y, m, d = civil_from_days(day)
  return string.format("%04d-%02d-%02dT%02d:%02d:%02d", y, m, d, floor(secs / 3600), floor(secs / 60) % 60, secs % 60)
end

local function parse_ymd(s)
  local y, m, d = s:match("^(%d%d%d%d)-(%d%d)-(%d%d)$")
  if not y then error("dates must be YYYY-MM-DD, got " .. tostring(s), 3) end
  return days_from_civil(tonumber(y), tonumber(m), tonumber(d))
end

---------------------------------------------------------------------------------------------------
-- Parsing

-- "NAME;P1=a;P2="b:c":value" -> name, params, value. Colons and semicolons inside quotes don't count.
local function split_line(line)
  local head_end, quoted = nil, false
  for i = 1, #line do
    local c = line:sub(i, i)
    if c == '"' then quoted = not quoted
    elseif c == ":" and not quoted then head_end = i break end
  end
  if not head_end then return nil end
  local head, value = line:sub(1, head_end - 1), line:sub(head_end + 1)
  local name, params = nil, {}
  for part in head:gmatch("[^;]+") do
    if not name then
      name = part:upper()
    else
      local k, v = part:match("^([^=]+)=(.*)$")
      if k then params[k:upper()] = v:gsub('^"(.*)"$', "%1") end
    end
  end
  return name, params, value
end

local function unescape(text)
  return (text:gsub("\\(.)", function(c)
    if c == "n" or c == "N" then return "\n" end
    return c
  end))
end

-- One DTSTART-like value: { day, secs (nil for a date), zone ("UTC", a TZID, or nil for floating) }.
local function parse_when(value, params)
  local y, m, d = value:match("^(%d%d%d%d)(%d%d)(%d%d)$")
  if y and (params.VALUE == nil or params.VALUE == "DATE") then
    return { day = days_from_civil(tonumber(y), tonumber(m), tonumber(d)) }
  end
  local Y, M, D, h, mi, s, z = value:match("^(%d%d%d%d)(%d%d)(%d%d)T(%d%d)(%d%d)(%d%d)(Z?)$")
  if not Y then return nil end
  return {
    day = days_from_civil(tonumber(Y), tonumber(M), tonumber(D)),
    secs = tonumber(h) * 3600 + tonumber(mi) * 60 + tonumber(s),
    zone = z == "Z" and "UTC" or params.TZID,
  }
end

-- "P1D", "PT1H30M", "P1W" -> { days, secs }
local function parse_duration(value)
  local sign, rest = value:match("^([+-]?)P(.+)$")
  if not rest then return nil end
  local weeks = tonumber(rest:match("^(%d+)W")) or 0
  local days = tonumber(rest:match("(%d+)D")) or 0
  local time = rest:match("T(.*)$") or ""
  local secs = (tonumber(time:match("(%d+)H")) or 0) * 3600 + (tonumber(time:match("(%d+)M")) or 0) * 60 + (tonumber(time:match("(%d+)S")) or 0)
  local k = sign == "-" and -1 or 1
  return { days = k * (weeks * 7 + days), secs = k * secs }
end

-- The feed's name and its VEVENTs, each a table of properties: { NAME = { value, params } }, with
-- EXDATE collected as a list.
local function parse(text)
  text = text:gsub("\r\n", "\n"):gsub("\r", "\n"):gsub("\n[ \t]", "")
  if not text:find("BEGIN:VCALENDAR", 1, true) then error("not an iCalendar feed", 0) end
  local name, events, stack, current = nil, {}, {}, nil
  for line in text:gmatch("[^\n]+") do
    local prop, params, value = split_line(line)
    if prop == "BEGIN" then
      stack[#stack + 1] = value:upper()
      if value:upper() == "VEVENT" then current = { EXDATE = {} } end
    elseif prop == "END" then
      if value:upper() == "VEVENT" and current then events[#events + 1] = current current = nil end
      stack[#stack] = nil
    elseif prop and current and stack[#stack] == "VEVENT" then
      if prop == "EXDATE" then
        for v in value:gmatch("[^,]+") do current.EXDATE[#current.EXDATE + 1] = { value = v, params = params } end
      else
        current[prop] = { value = value, params = params }
      end
    elseif prop == "X-WR-CALNAME" and #stack == 1 then
      name = unescape(value)
    end
  end
  return name or "Calendar", events
end

---------------------------------------------------------------------------------------------------
-- Recurrence rules

local SUPPORTED = { FREQ = true, INTERVAL = true, COUNT = true, UNTIL = true, BYDAY = true, BYMONTHDAY = true, BYMONTH = true, WKST = true }

local function parse_rule(text)
  local r = { interval = 1 }
  for part in text:gmatch("[^;]+") do
    local k, v = part:match("^([^=]+)=(.*)$")
    if not k then error("bad RRULE part " .. part, 0) end
    k = k:upper()
    if not SUPPORTED[k] then error("unsupported RRULE part " .. k, 0) end
    if k == "FREQ" then r.freq = v:upper()
    elseif k == "INTERVAL" then r.interval = tonumber(v) or error("bad INTERVAL", 0)
    elseif k == "COUNT" then r.count = tonumber(v) or error("bad COUNT", 0)
    elseif k == "UNTIL" then r.until_at = parse_when(v, {}) or error("bad UNTIL " .. v, 0)
    elseif k == "BYDAY" then
      r.byday = {}
      for item in v:gmatch("[^,]+") do
        local n, wd = item:match("^([+-]?%d*)(%a%a)$")
        if not wd or not WEEKDAYS[wd:upper()] then error("bad BYDAY " .. item, 0) end
        r.byday[#r.byday + 1] = { wd = WEEKDAYS[wd:upper()], n = tonumber(n) }
      end
    elseif k == "BYMONTHDAY" then
      r.bymonthday = {}
      for item in v:gmatch("[^,]+") do r.bymonthday[#r.bymonthday + 1] = tonumber(item) or error("bad BYMONTHDAY", 0) end
    elseif k == "BYMONTH" then
      r.bymonth = {}
      for item in v:gmatch("[^,]+") do r.bymonth[tonumber(item) or error("bad BYMONTH", 0)] = true end
    end
  end
  if r.freq ~= "DAILY" and r.freq ~= "WEEKLY" and r.freq ~= "MONTHLY" and r.freq ~= "YEARLY" then
    error("unsupported FREQ " .. tostring(r.freq), 0)
  end
  if r.freq == "YEARLY" and r.byday and not r.bymonth then error("unsupported: YEARLY with BYDAY and no BYMONTH", 0) end
  return r
end

local function sorted_unique(list)
  table.sort(list)
  local out = {}
  for _, v in ipairs(list) do if out[#out] ~= v then out[#out + 1] = v end end
  return out
end

-- The days a rule picks inside one month: BYMONTHDAY, BYDAY (all matching weekdays, or the nth),
-- or `default_dom` (the series' day of the month) when neither is given.
local function month_days(rule, y, m, default_dom)
  local first, len = days_from_civil(y, m, 1), days_in_month(y, m)
  local out = {}
  if rule.bymonthday then
    for _, md in ipairs(rule.bymonthday) do
      local dom = md > 0 and md or len + md + 1
      if dom >= 1 and dom <= len then out[#out + 1] = first + dom - 1 end
    end
    if rule.byday then
      local keep = {}
      for _, b in ipairs(rule.byday) do keep[b.wd] = true end
      local filtered = {}
      for _, day in ipairs(out) do if keep[weekday(day)] then filtered[#filtered + 1] = day end end
      out = filtered
    end
  elseif rule.byday then
    for _, b in ipairs(rule.byday) do
      local offset = (b.wd - weekday(first)) % 7
      if b.n == nil then
        for dom = 1 + offset, len, 7 do out[#out + 1] = first + dom - 1 end
      elseif b.n > 0 then
        local dom = 1 + offset + (b.n - 1) * 7
        if dom <= len then out[#out + 1] = first + dom - 1 end
      else
        local last_offset = (weekday(first + len - 1) - b.wd) % 7
        local dom = len - last_offset + (b.n + 1) * 7
        if dom >= 1 then out[#out + 1] = first + dom - 1 end
      end
    end
  elseif default_dom <= len then
    out[1] = first + default_dom - 1
  end
  return sorted_unique(out)
end

-- Candidate days of period k (the k-th step of FREQ * INTERVAL from the series start), ascending.
local function period_days(rule, start_day, k)
  local freq, step = rule.freq, rule.interval * k
  local sy, sm, sd = civil_from_days(start_day)
  local days = {}
  if freq == "DAILY" then
    local day = start_day + step
    local y, m, d = civil_from_days(day)
    local ok = (not rule.bymonth or rule.bymonth[m])
    if ok and rule.byday then
      ok = false
      for _, b in ipairs(rule.byday) do if b.wd == weekday(day) then ok = true end end
    end
    if ok and rule.bymonthday then
      ok = false
      for _, md in ipairs(rule.bymonthday) do
        if md == d or md == d - days_in_month(y, m) - 1 then ok = true end
      end
    end
    if ok then days[1] = day end
  elseif freq == "WEEKLY" then
    local week = start_day - weekday(start_day) + 7 * step
    if rule.byday then
      for _, b in ipairs(rule.byday) do days[#days + 1] = week + b.wd end
    else
      days[1] = week + weekday(start_day)
    end
    days = sorted_unique(days)
    if rule.bymonth then
      local kept = {}
      for _, day in ipairs(days) do
        local _, m = civil_from_days(day)
        if rule.bymonth[m] then kept[#kept + 1] = day end
      end
      days = kept
    end
  elseif freq == "MONTHLY" then
    local index = (sy * 12 + sm - 1) + step
    local y, m = floor(index / 12), index % 12 + 1
    if not rule.bymonth or rule.bymonth[m] then days = month_days(rule, y, m, sd) end
  else -- YEARLY
    local y = sy + step
    local months = {}
    if rule.bymonth then for m in pairs(rule.bymonth) do months[#months + 1] = m end else months[1] = sm end
    table.sort(months)
    for _, m in ipairs(months) do
      for _, day in ipairs(month_days(rule, y, m, sd)) do days[#days + 1] = day end
    end
  end
  return days
end

---------------------------------------------------------------------------------------------------
-- Occurrences

local MAX_PERIODS = 20000

--- Every occurrence of the events in `text` that overlaps the window, sorted by start.
--- window: { from = "YYYY-MM-DD", to = "YYYY-MM-DD" (exclusive) } or { from = ..., days = n }.
--- Each event: { title, start, end, all_day, calendar }; timed ones in RFC 3339 in the host zone,
--- all-day ones as YYYY-MM-DD (end exclusive).
function M.events(text, window, ctx)
  local calendar, vevents = parse(text)
  local from_day = parse_ymd(window.from)
  local to_day = window.to and parse_ymd(window.to) or from_day + (window.days or 1)

  -- ctx.instant, cached, and forgiving about zone names the host doesn't know (treated as the host zone).
  local cache = {}
  local function at(day, secs, zone)
    local key = wall(day, secs) .. "|" .. tostring(zone)
    local hit = cache[key]
    if hit then return hit end
    local ok, result = pcall(ctx.instant, wall(day, secs), zone)
    if not ok then result = ctx.instant(wall(day, secs), nil) end
    cache[key] = result
    return result
  end
  local win_start = at(from_day, 0, nil).epoch
  local win_end = at(to_day, 0, nil).epoch

  local function key_of(when)
    if when.secs == nil then return "d:" .. when.day end
    return "t:" .. at(when.day, when.secs, when.zone).epoch
  end

  -- Overrides: an event with RECURRENCE-ID replaces (or, when cancelled, removes) one occurrence of its series.
  local overridden = {}
  for _, e in ipairs(vevents) do
    local rid = e["RECURRENCE-ID"]
    if rid and e.UID then
      local when = parse_when(rid.value, rid.params)
      if when then overridden[e.UID.value .. "|" .. key_of(when)] = true end
    end
  end

  local out = {}
  local function emit(title, s, e)
    if s.secs == nil then
      if s.day < to_day and e.day > from_day then
        out[#out + 1] = { title = title, start = ymd(s.day), ["end"] = ymd(e.day), all_day = true, calendar = calendar }
      end
      return
    end
    local sa, ea = at(s.day, s.secs, s.zone), at(e.day, e.secs, e.zone)
    if sa.epoch < win_end and ea.epoch >= win_start and (ea.epoch > win_start or sa.epoch >= win_start) then
      out[#out + 1] = { title = title, start = sa.iso, ["end"] = ea.iso, all_day = false, calendar = calendar }
    end
  end

  for _, e in ipairs(vevents) do
    local ok, err = pcall(function()
      local status = e.STATUS and e.STATUS.value:upper()
      local s = e.DTSTART and parse_when(e.DTSTART.value, e.DTSTART.params)
      if not s or status == "CANCELLED" then return end
      local title = e.SUMMARY and unescape(e.SUMMARY.value) or "Untitled"

      -- The event's length on the wall clock: DTEND, else DURATION, else a day (dates) or nothing (times).
      local len_days, len_secs = (s.secs == nil) and 1 or 0, 0
      local dtend = e.DTEND and parse_when(e.DTEND.value, e.DTEND.params)
      if dtend then
        if s.secs == nil or dtend.secs == nil then
          len_days = dtend.day - s.day
        elseif dtend.zone == s.zone then
          len_secs = (dtend.day - s.day) * 86400 + dtend.secs - s.secs
        else
          len_secs = at(dtend.day, dtend.secs, dtend.zone).epoch - at(s.day, s.secs, s.zone).epoch
        end
      elseif e.DURATION then
        local d = parse_duration(e.DURATION.value)
        if d then len_days, len_secs = d.days, d.secs end
        if s.secs == nil then len_days = len_days + floor(len_secs / 86400) len_secs = 0 end
      end
      local function ending(day, secs)
        if secs == nil then return { day = day + len_days } end
        local total = secs + len_secs
        return { day = day + len_days + floor(total / 86400), secs = total % 86400, zone = s.zone }
      end

      if not e.RRULE or e["RECURRENCE-ID"] then
        emit(title, s, ending(s.day, s.secs))
        return
      end

      local rule = parse_rule(e.RRULE.value)
      local excluded = {}
      for _, x in ipairs(e.EXDATE) do
        local when = parse_when(x.value, x.params)
        if when then
          if s.secs ~= nil and when.secs == nil then when = { day = when.day, secs = s.secs, zone = s.zone } end
          excluded[key_of(when)] = true
        end
      end
      local uid = e.UID and e.UID.value or ""

      -- UNTIL is inclusive. A date compares by day; a time compares as a moment, near the boundary only.
      local until_day, until_epoch = nil, nil
      if rule.until_at then
        until_day = rule.until_at.day
        if rule.until_at.secs ~= nil and s.secs ~= nil then
          until_epoch = at(rule.until_at.day, rule.until_at.secs, rule.until_at.zone or s.zone).epoch
        end
      end
      local function past_until(day)
        if not until_day then return false end
        if day > until_day + 1 then return true end
        if day < until_day - 1 or not until_epoch then return day > until_day end
        return at(day, s.secs, s.zone).epoch > until_epoch
      end

      -- Without COUNT, jump straight to the periods near the window.
      local first_k = 0
      if not rule.count then
        local span = rule.freq == "DAILY" and 1 or rule.freq == "WEEKLY" and 7 or nil
        if span then first_k = math.max(0, floor((from_day - len_days - 8 - s.day) / (span * rule.interval))) end
      end
      local count, last_needed = 0, to_day + 1
      for k = first_k, first_k + MAX_PERIODS do
        local days = period_days(rule, s.day, k)
        local done = false
        for _, day in ipairs(days) do
          if day >= s.day then
            if past_until(day) or day > last_needed then done = true break end
            count = count + 1
            local occ = { day = day, secs = s.secs, zone = s.zone }
            if day >= from_day - len_days - 2 then
              local key = key_of(occ)
              if not excluded[key] and not overridden[uid .. "|" .. key] then emit(title, occ, ending(day, s.secs)) end
            end
            if rule.count and count >= rule.count then done = true break end
          end
        end
        if done then break end
        -- Periods are in order; once a whole period starts past the window, nothing later can matter.
        if #days > 0 and days[1] > last_needed then break end
      end
    end)
    if not ok then
      local name = e.SUMMARY and e.SUMMARY.value or "an event"
      if ctx.log then ctx.log("warn", "calendar: skipping " .. name .. ": " .. tostring(err)) end
    end
  end

  table.sort(out, function(a, b)
    if a.start ~= b.start then return a.start < b.start end
    return a.title < b.title
  end)
  return out
end

M.parse_ymd = parse_ymd
M.ymd = ymd

return M
