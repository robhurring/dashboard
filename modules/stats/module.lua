-- Numbers pushed in from anywhere: unread messages, mentions, emails, open documents, builds, ...
-- Each push names its source and replaces only that source's numbers, so several senders share one
-- panel without overwriting each other; `"replace": true` makes a push the whole panel. Body:
--   { "source": "slack", "stats": { "Unread": { "number": 12 }, "Urgent": { "number": 2, "tone": "bad", "icon": "bell" } } }
-- One panel per instance: <Slot module="stats" instance="work" /> takes pushes at /hooks/stats:work/push.
local TONES = { accent = true, good = true, warn = true, bad = true }

local function stat(source, label, v)
  if type(v) ~= "table" or type(v.number) ~= "number" then
    -- No label in the message: labels may be private, and errors are logged.
    error("every stat needs a numeric `number`")
  end
  return {
    source = source,
    label = tostring(label),
    number = v.number,
    tone = TONES[v.tone] and v.tone or nil,
    icon = type(v.icon) == "string" and v.icon or nil,
    sub = type(v.sub) == "string" and v.sub or nil,
    order = type(v.order) == "number" and v.order or 1000,
    ring = v.ring == true or nil,
  }
end

---@type Module
return {
  name = "stats",
  icon = "layout-grid",
  title = "Stats",

  hooks = {
    push = {
      description = "Set one source's numbers (e.g. slack, email). Send all of that source's labels each time: "
        .. "its labels not sent disappear; other sources are kept, unless `replace` is true. An empty `stats` clears the source.",
      -- The shared hook token from the environment: send "Authorization: Bearer $HOOKS_TOKEN".
      auth = { token = "HOOKS_TOKEN" },
      schema = {
        type = "object",
        required = { "stats" },
        properties = {
          source = { type = "string", description = "Who is sending, e.g. slack, email, docs. Default: \"default\"" },
          replace = { type = "boolean", description = "This push is the whole panel: drop every other source's stats too" },
          stats = {
            type = "object",
            description = "Label → stat. Labels are shown as given.",
            additionalProperties = {
              type = "object",
              required = { "number" },
              properties = {
                number = { type = "number", description = "The figure shown large" },
                tone = { type = "string", enum = { "accent", "good", "warn", "bad" }, description = "Color of the figure; omit for the default ink" },
                icon = { type = "string", description = "A Lucide icon name, e.g. bell, at-sign, inbox, mail, file-text" },
                sub = { type = "string", description = "One short line under the label" },
                order = { type = "number", description = "Sort key; lower comes first, then by label" },
                ring = { type = "boolean", description = "Ring the bell when this number goes up (tone bad rings anyway)" },
              },
            },
          },
        },
      },
      example = {
        source = "slack",
        stats = {
          Unread = { number = 12, icon = "inbox" },
          Mentions = { number = 3, icon = "at-sign", tone = "warn" },
          Urgent = { number = 1, icon = "bell", tone = "bad", order = 0, sub = "#incident" },
        },
      },
      ---@param ctx Ctx
      handle = function(ctx, req)
        local body = req.body
        if type(body) ~= "table" or type(body.stats) ~= "table" or body.stats[1] ~= nil then
          error("body must be { source?, stats = { label = { number, ... } } }")
        end
        local source = type(body.source) == "string" and body.source ~= "" and body.source or "default"
        local fresh = {}
        for label, v in pairs(body.stats) do fresh[#fresh + 1] = stat(source, label, v) end

        -- Keep every other source's stats and replace this one's; with replace, keep nothing.
        local items = json.array({})
        if body.replace ~= true then
          for _, it in ipairs((ctx.state and ctx.state.items) or {}) do
            if it.source ~= source then items[#items + 1] = it end
          end
        end
        for _, it in ipairs(fresh) do items[#items + 1] = it end
        table.sort(items, function(a, b)
          if a.order ~= b.order then return a.order < b.order end
          if a.label ~= b.label then return a.label < b.label end
          return a.source < b.source
        end)
        return { items = items, pushed_at = ctx.now() }
      end,
    },
  },

  -- Rendered by ui/index.tsx: one tile per stat.
  component = "Stats",
}
