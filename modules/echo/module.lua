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
    -- Remember the text, newest first. An error here rejects the component's `send` with its message;
    -- level 0 leaves out Lua's "file:line:" prefix, which a screen shouldn't show.
    ---@param ctx Ctx
    echo = function(ctx, args)
      local text = type(args.text) == "string" and args.text:match("^%s*(.-)%s*$") or ""
      if text == "" then error("say something first", 0) end
      local messages = json.array({ { text = text, at = ctx.now() } })
      for _, m in ipairs(ctx.state.messages) do
        if #messages >= ctx.config.keep then break end
        messages[#messages + 1] = m
      end
      return { messages = messages, pings = ctx.state.pings }
    end,

    -- Count a pong. Commands don't have to take arguments.
    ---@param ctx Ctx
    ping = function(ctx)
      return { messages = json.array(ctx.state.messages), pings = ctx.state.pings + 1 }
    end,
  },
}
