-- OpenRouter: one API for models from Anthropic, OpenAI, Google, TypeSafe (Jev) and others. Any module
-- can use it:
--
--   local openrouter = require("openrouter")
--   local text = openrouter.ask(ctx, "Summarize: " .. notes, { model = "anthropic/claude-sonnet-4.5", system = "Be brief." })
--   local answers = openrouter.decide(ctx, { state = ticket, questions = { urgent = { type = "noul", ... } } })
--   local clip = openrouter.speak(ctx, "Your 3pm is in ten minutes")       -- { data, type } for ui.audio
--   local picture = openrouter.image(ctx, "A watercolor of the garden")   -- { data, type } for ui.image
--   local raw = openrouter.request(ctx, "/embeddings", { model = "...", input = "..." })   -- any other endpoint
--
-- Needs OPENROUTER_API_KEY in the environment. Requests identify the app to OpenRouter as
-- OPENROUTER_APP_NAME (default "dashboard") at OPENROUTER_APP_URL (default this project's repo), which
-- is how its usage shows up in OpenRouter's app pages and rankings. Model names are OpenRouter's (https://openrouter.ai/models);
-- without one it uses OPENROUTER_MODEL if set, else "openrouter/auto", which picks a model per request.
-- Model calls can take a while; a module's fetch is allowed minutes.

local SITE = "https://openrouter.ai"
local API = SITE .. "/api/v1"

local M = {}

local function setting(ctx, name, fallback)
  local ok, value = pcall(ctx.env, name)
  return ok and value or fallback
end

-- Auth plus app attribution: HTTP-Referer identifies the app, X-OpenRouter-Title names it.
local function headers(ctx)
  return {
    Authorization = "Bearer " .. ctx.env("OPENROUTER_API_KEY"),
    ["HTTP-Referer"] = setting(ctx, "OPENROUTER_APP_URL", "https://github.com/robhurring/dashboard"),
    ["X-OpenRouter-Title"] = setting(ctx, "OPENROUTER_APP_NAME", "dashboard"),
  }
end

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
    headers = headers(ctx),
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

--- Text to speech. Returns { data = <base64>, type = "audio/mpeg" }, ready for ui.audio:
---   ui.audio { data = clip.data, type = clip.type, label = "Briefing", autoplay = true }
--- opts: model (default OPENROUTER_TTS_MODEL, else "mistralai/voxtral-mini-tts-2603"), voice,
--- instructions (tone and pacing, for models that take them), speed, response_format (default "mp3").
---@param ctx Ctx
---@param text string
---@param opts table|nil
---@return { data: string, type: string }
function M.speak(ctx, text, opts)
  opts = opts or {}
  local model = opts.model or setting(ctx, "OPENROUTER_TTS_MODEL", "mistralai/voxtral-mini-tts-2603")
  local body = { input = text, model = model, response_format = opts.response_format or "mp3" }
  for k, v in pairs(opts) do if body[k] == nil then body[k] = v end end
  -- The default model needs a voice; other models choose their own when none is given.
  if body.voice == nil and model == "mistralai/voxtral-mini-tts-2603" then body.voice = "en_paul_neutral" end
  return ctx.http.post(API .. "/audio/speech", {
    json = body,
    as = "base64",
    headers = headers(ctx),
  })
end

--- Text to image. Returns { data = <base64>, type = "image/png" }, ready for ui.image:
---   ui.image { data = picture.data, type = picture.type, alt = prompt }
--- opts: model (default OPENROUTER_IMAGE_MODEL, else "google/gemini-2.5-flash-image"), and any chat
--- request options (image_config, ...).
---@param ctx Ctx
---@param prompt string
---@param opts table|nil
---@return { data: string, type: string }
function M.image(ctx, prompt, opts)
  opts = opts or {}
  local request = { modalities = { "image", "text" }, messages = { { role = "user", content = prompt } } }
  for k, v in pairs(opts) do request[k] = v end
  request.model = opts.model or setting(ctx, "OPENROUTER_IMAGE_MODEL", "google/gemini-2.5-flash-image")
  local response = M.request(ctx, "/chat/completions", request)
  local message = response.choices and response.choices[1] and response.choices[1].message or {}
  local image = message.images and message.images[1]
  local url = image and image.image_url and image.image_url.url
  if type(url) ~= "string" then error("openrouter: the response had no image", 0) end
  local mime, data = url:match("^data:([^;]+);base64,(.+)$")
  if not data then error("openrouter: the image wasn't inline base64", 0) end
  return { data = data, type = mime }
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
