-- Push-only Slack stats, sent by an agent on the work machine. Each push replaces the whole set.
-- Body: a map of label → { number, tone?, icon?, sub?, order? }, e.g.
--   { "Unread": { "number": 12 }, "Urgent": { "number": 2, "tone": "bad", "icon": "bell" } }
local TONES = { accent = true, good = true, warn = true, bad = true }

---@type Module
return {
  name = "slack",
  icon = "message-square",
  title = "Slack",

  hooks = {
    push = {
      description = "Replace the Slack stats shown on the dashboard. Send every label each time; labels not sent disappear.",
      -- The shared hook token from the environment: send "Authorization: Bearer $HOOKS_TOKEN".
      auth = { token = "HOOKS_TOKEN" },
      schema = {
        type = "object",
        description = "Label → stat. Labels are shown as given.",
        -- JSON Schema: any key is allowed (each one is a label you choose), and every value must match this.
        additionalProperties = {
          type = "object",
          required = { "number" },
          properties = {
            number = { type = "number", description = "The figure shown large" },
            tone = { type = "string", enum = { "accent", "good", "warn", "bad" }, description = "Color of the figure; omit for the default ink" },
            icon = { type = "string", description = "A Lucide icon name, e.g. bell, at-sign, hash, inbox, mail" },
            sub = { type = "string", description = "One short line under the label" },
            order = { type = "number", description = "Sort key; lower comes first, then by label" },
            ring = { type = "boolean", description = "Ring the bell when this number goes up (tone bad rings anyway)" },
          },
        },
      },
      example = {
        Unread = { number = 12, icon = "inbox" },
        Mentions = { number = 3, icon = "at-sign", tone = "warn" },
        Urgent = { number = 1, icon = "bell", tone = "bad", order = 0, sub = "#incident" },
      },
      ---@param ctx Ctx
      handle = function(ctx, req)
        if type(req.body) ~= "table" then error("body must be a JSON object of label → { number }") end
        local items = json.array({})
        for label, v in pairs(req.body) do
          if type(v) ~= "table" or type(v.number) ~= "number" then error("label " .. tostring(label) .. " needs a numeric `number`") end
          items[#items + 1] = {
            label = tostring(label),
            number = v.number,
            tone = TONES[v.tone] and v.tone or nil,
            icon = type(v.icon) == "string" and v.icon or nil,
            sub = type(v.sub) == "string" and v.sub or nil,
            order = type(v.order) == "number" and v.order or 1000,
            ring = v.ring == true or nil,
          }
        end
        table.sort(items, function(a, b)
          if a.order ~= b.order then return a.order < b.order end
          return a.label < b.label
        end)
        return { items = items, pushed_at = ctx.now() }
      end,
    },
  },

  -- Rendered by ui/index.tsx: one tile per label.
  component = "SlackStats",
}
