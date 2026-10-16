-- Todoist tasks as a board: a Backlog plus one column per section of the board project.
-- Backlog holds Inbox tasks, overdue tasks from anywhere, and board tasks that have no section.
local API = "https://api.todoist.com/api/v1"

local function headers(ctx) return { Authorization = "Bearer " .. ctx.env("TODOIST_API_TOKEN") } end

-- Follows Todoist's cursor pagination.
local function fetch_all(ctx, path)
  local items, cursor = {}, nil
  for _ = 1, 20 do
    local query = { limit = 200 }
    if cursor then query.cursor = cursor end
    local r = ctx.http.get(API .. path, { headers = headers(ctx), query = query })
    for _, item in ipairs(r.results or {}) do items[#items + 1] = item end
    cursor = r.next_cursor
    if not cursor or cursor == "" then break end
  end
  return items
end

-- Days since 1970-01-01 for a calendar date (Howard Hinnant's days_from_civil).
local function day_number(y, m, d)
  if m <= 2 then y = y - 1 end
  local era = math.floor(y / 400)
  local yoe = y - era * 400
  local mp = (m + 9) % 12
  local doy = math.floor((153 * mp + 2) / 5) + d - 1
  local doe = yoe * 365 + math.floor(yoe / 4) - math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
end

local function days_between(from, to)
  local fy, fm, fd = from:match("^(%d+)-(%d+)-(%d+)")
  local ty, tm, td = to:match("^(%d+)-(%d+)-(%d+)")
  if not (fy and ty) then return nil end
  return day_number(tonumber(ty), tonumber(tm), tonumber(td)) - day_number(tonumber(fy), tonumber(fm), tonumber(fd))
end

local function lower(s) return string.lower(s or "") end

---@type Module
return {
  name = "todoist",
  icon = "list-todo",
  every = "5m",
  title = "Tasks · {{state.total}} open",
  config = {
    project = required,   -- the board project's name, e.g. <Slot module="todoist" project="Board" />
  },
  -- Rendered by ui/index.tsx: TodoistBoard (default) or TodoistList via a slot's `component` prop.
  component = "TodoistBoard",

  ---@param ctx Ctx
  fetch = function(ctx)
    local project_name = ctx.config.project
    local today = ctx.today()

    local projects = fetch_all(ctx, "/projects")
    local sections = fetch_all(ctx, "/sections")
    local tasks = fetch_all(ctx, "/tasks")

    local project_names, inbox_id, board_id = {}, nil, nil
    for _, p in ipairs(projects) do
      project_names[p.id] = p.name
      if lower(p.name) == "inbox" then inbox_id = p.id end
      if lower(p.name) == lower(project_name) then board_id = p.id end
    end
    if not board_id then error("no Todoist project named " .. project_name) end

    local board_sections = {}
    for _, s in ipairs(sections) do
      if s.project_id == board_id then board_sections[#board_sections + 1] = s end
    end
    table.sort(board_sections, function(a, b) return (a.order or 0) < (b.order or 0) end)

    local columns = { { key = "backlog", label = "Backlog", items = json.array({}) } }
    local by_section = {}
    for _, s in ipairs(board_sections) do
      local col = { key = s.name, label = s.name, section_id = s.id, items = json.array({}) }
      columns[#columns + 1] = col
      by_section[s.id] = col
    end

    local total = 0
    for _, t in ipairs(tasks) do
      local due = t.due and t.due.date and string.sub(t.due.date, 1, 10) or nil
      local late = due and days_between(due, today) or 0
      local item = {
        id = t.id,
        content = t.content or "",
        description = t.description or "",
        due = due,
        priority = t.priority or 1,
        project_name = project_names[t.project_id],
        labels = json.array(t.labels or {}),
        days_overdue = late > 0 and late or nil,
        overdue = late > 0,
        section_id = t.section_id,
        added_at = t.added_at,
        updated_at = t.updated_at,
        is_recurring = (t.due and t.due.is_recurring) or false,
      }
      local col
      if t.project_id == board_id and by_section[t.section_id] then
        col = by_section[t.section_id]
      elseif item.overdue or t.project_id == board_id or t.project_id == inbox_id then
        col = columns[1]
      end
      if col then
        col.items[#col.items + 1] = item
        total = total + 1
      end
    end

    -- Overdue first, then priority (4 = P1), then a stable id order.
    for _, col in ipairs(columns) do
      table.sort(col.items, function(a, b)
        if a.overdue ~= b.overdue then return a.overdue end
        if a.priority ~= b.priority then return a.priority > b.priority end
        return a.id < b.id
      end)
    end

    return { columns = columns, total = total, project_id = board_id, synced_at = ctx.now() }
  end,

  commands = {
    -- Move to a section, or to the board project root (the Backlog) without one.
    move = function(ctx, a)
      local body = a.section_id and { section_id = a.section_id } or { project_id = ctx.state.project_id }
      ctx.http.post(API .. "/tasks/" .. a.id .. "/move", { json = body, headers = headers(ctx) })
      ctx.refresh()
    end,
    -- Recurring tasks advance to their next date instead of closing.
    complete = function(ctx, a)
      ctx.http.post(API .. "/tasks/" .. a.id .. "/close", { headers = headers(ctx) })
      ctx.refresh()
    end,
    reopen = function(ctx, a)
      ctx.http.post(API .. "/tasks/" .. a.id .. "/reopen", { headers = headers(ctx) })
      ctx.refresh()
    end,
  },
}
