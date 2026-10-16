-- A small, working example of a module with its own React component and commands. Place it with
-- <Slot module="echo" chrome="full" /> (the gallery theme does) and type into it.
--
-- How the pieces connect:
--   1. `fetch` returns the module's state. The server keeps it and sends it to every screen.
--   2. `component = "Echo"` tells screens to draw that state with the `Echo` export of ui/index.tsx,
--      instead of a widget tree from `view`.
--   3. The component calls `send("echo", { text = "hi" })`. The server runs `commands.echo` with
--      those args, against the current state.
--   4. A command that returns a table replaces the state, so every screen showing this instance
--      updates. `send` resolves when the command finishes, or rejects with the command's error.
--   5. A hook does the same for callers outside the dashboard: POST /hooks/echo/say with
--      { "text": "..." } adds a message, exactly as the Echo button does.

-- The new state after remembering `text`: newest first, at most `keep` messages. The error's level 0
-- leaves out Lua's "file:line:" prefix, so a screen shows just the message.
local function remember(state, text, keep, now)
  text = type(text) == "string" and text:match("^%s*(.-)%s*$") or ""
  if text == "" then error("say something first", 0) end
  local messages = json.array({ { text = text, at = now } })
  for _, m in ipairs(state and state.messages or {}) do
    if #messages >= keep then break end
    messages[#messages + 1] = m
  end
  return { messages = messages, pings = state and state.pings or 0 }
end

---@type Module
return {
  name = "echo",
  icon = "message-square",
  title = "Echo",
  component = "Echo",
  config = {
    keep = 5,   -- how many messages to remember
  },

  -- No schedule: this runs once, when a screen first shows the instance, to set the starting state.
  ---@param ctx Ctx
  fetch = function(ctx)
    return ctx.state or { messages = json.array({}), pings = 0 }
  end,

  commands = {
    -- Remember the text. An error here rejects the component's `send` with its message.
    ---@param ctx Ctx
    echo = function(ctx, args)
      return remember(ctx.state, args.text, ctx.config.keep, ctx.now())
    end,

    -- Count a pong. Commands don't have to take arguments.
    ---@param ctx Ctx
    ping = function(ctx)
      return { messages = json.array(ctx.state.messages), pings = ctx.state.pings + 1 }
    end,
  },

  hooks = {
    say = {
      description = "Add a message to the echo panel, as if someone typed it.",
      -- Callers send "Authorization: Bearer $HOOKS_TOKEN". With HOOKS_TOKEN unset (local development), anyone can.
      auth = { token = "HOOKS_TOKEN" },
      schema = {
        type = "object",
        required = { "text" },
        properties = { text = { type = "string", description = "What to say" } },
      },
      example = { text = "Backup finished" },
      ---@param ctx Ctx
      handle = function(ctx, req)
        return remember(ctx.state, type(req.body) == "table" and req.body.text, ctx.config.keep, ctx.now())
      end,
    },
  },
}
