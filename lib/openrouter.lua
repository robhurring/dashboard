-- OpenRouter: one API for models from Anthropic, OpenAI, Google, TypeSafe (Jev) and others. Any module
-- can use it:
--
--   local openrouter = require("openrouter")
--   local text = openrouter.ask(ctx, "Summarize: " .. notes, { model = "anthropic/claude-sonnet-4.5", system = "Be brief." })
--   local answers = openrouter.decide(ctx, { state = ticket, questions = { urgent = { type = "noul", ... } } })
--   local raw = openrouter.request(ctx, "/embeddings", { model = "...", input = "..." })   -- any other endpoint
--
-- Needs OPENROUTER_API_KEY in the environment. Model names are OpenRouter's (https://openrouter.ai/models);
-- without one it uses OPENROUTER_MODEL if set, else "openrouter/auto", which picks a model per request.
-- Model calls can take a while; a module's fetch is allowed minutes.

local SITE = "https://openrouter.ai"
local API = SITE .. "/api/v1"

local M = {}

local function default_model(ctx)
  local ok, model = pcall(ctx.env, "OPENROUTER_MODEL")
  return ok and model or "openrouter/auto"
end

--- POSTs `body` to any OpenRouter endpoint and returns the decoded response. `path` is relative to the
--- API ("/responses", "/messages", "/embeddings", "/systemone", ...), or a full URL. Raises on an HTTP
--- error or an error in the response.
---@param ctx Ctx
---@param path string
---@param body table
---@return table
function M.request(ctx, path, body)
  local url = path:match("^https?://") and path or (API .. path)
  local response = ctx.http.post(url, {
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

local function with_model(request, model)
  local body = {}
  for k, v in pairs(request) do body[k] = v end
  body.model = body.model or model
  return body
end

--- Sends a chat completion request and returns OpenRouter's whole response (choices, usage, ...).
--- `request` is OpenRouter's request body: model, messages, and any of its options (max_tokens,
--- temperature, response_format, tools, ...).
---@param ctx Ctx
---@param request table
---@return table
function M.chat(ctx, request)
  return M.request(ctx, "/chat/completions", with_model(request, default_model(ctx)))
end

--- Asks a decision model (Jev by default) typed questions about some state, through OpenRouter's
--- Decisions endpoint. Returns the answers by question name, and the whole response.
---   state      a string, or a table of related context
---   questions  name -> { type, instructions, criteria }. Types:
---              noul    criteria = { ["true"] = "...", ["false"] = "..." }   answer: { noul = 0..1 }
---              choice  criteria = { option = "description", ... }           answer: { choice, confidence, probabilities }
---              score   criteria = { "lowest", ..., "highest" }              answer: { score, confidence, probabilities, legend }
---              box     no criteria                                           answer: { box = { top, bottom, left, right } }
---   model      default "jev-latest", the newest Jev (a pinned version: "typesafe/jev-1.13")
---@param ctx Ctx
---@param request table
---@return table answers, table response
function M.decide(ctx, request)
  local response = M.request(ctx, SITE .. "/api/alpha/decisions", with_model(request, "jev-latest"))
  if type(response.answers) ~= "table" then error("openrouter: the response had no answers", 0) end
  return response.answers, response
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
