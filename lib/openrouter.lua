-- OpenRouter: one API for models from Anthropic, OpenAI, Google, Meta and others. Any module can use it:
--
--   local openrouter = require("openrouter")
--   local text = openrouter.ask(ctx, "Summarize: " .. notes, { model = "anthropic/claude-sonnet-4.5", system = "Be brief." })
--
-- Needs OPENROUTER_API_KEY in the environment. Model names are OpenRouter's (https://openrouter.ai/models);
-- without one it uses OPENROUTER_MODEL if set, else "openrouter/auto", which picks a model per request.
-- Model calls can take a while; a module's fetch is allowed minutes.

local API = "https://openrouter.ai/api/v1"

local M = {}

local function default_model(ctx)
  local ok, model = pcall(ctx.env, "OPENROUTER_MODEL")
  return ok and model or "openrouter/auto"
end

--- Sends a chat completion request and returns OpenRouter's whole response (choices, usage, ...).
--- `request` is OpenRouter's request body: model, messages, and any of its options (max_tokens,
--- temperature, response_format, tools, ...). Raises on an HTTP error or an error in the response.
---@param ctx Ctx
---@param request table
---@return table
function M.chat(ctx, request)
  local body = {}
  for k, v in pairs(request) do body[k] = v end
  body.model = body.model or default_model(ctx)
  local response = ctx.http.post(API .. "/chat/completions", {
    json = body,
    headers = {
      Authorization = "Bearer " .. ctx.env("OPENROUTER_API_KEY"),
      ["X-Title"] = "dashboard",
    },
  })
  if type(response) ~= "table" then error("openrouter: unexpected response", 0) end
  if response.error then
    local message = type(response.error) == "table" and response.error.message or tostring(response.error)
    error("openrouter: " .. tostring(message), 0)
  end
  return response
end

--- Asks one question and returns the answer's text, trimmed.
--- opts: model, system (a system prompt), and any other request options (max_tokens, temperature, ...).
---@param ctx Ctx
---@param prompt string
---@param opts table|nil
---@return string
function M.ask(ctx, prompt, opts)
  opts = opts or {}
  local request, messages = {}, {}
  for k, v in pairs(opts) do
    if k ~= "system" then request[k] = v end
  end
  if opts.system then messages[#messages + 1] = { role = "system", content = opts.system } end
  messages[#messages + 1] = { role = "user", content = prompt }
  request.messages = messages
  local response = M.chat(ctx, request)
  local choice = response.choices and response.choices[1]
  local content = choice and choice.message and choice.message.content
  if type(content) ~= "string" then error("openrouter: the response had no answer", 0) end
  return (content:gsub("^%s+", ""):gsub("%s+$", ""))
end

return M
