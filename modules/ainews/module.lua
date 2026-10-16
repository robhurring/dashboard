-- Headlines from the n8n AI news webhook: a list of { title, summary, url, source, publishedAt }.
local NAMED = { amp = "&", lt = "<", gt = ">", quot = '"', apos = "'", nbsp = " " }

-- Feeds often carry HTML entities in titles; decode the named ones and numeric (&#8217; &#x27;) ones.
local function unescape(s)
  if type(s) ~= "string" then return s end
  return (s:gsub("&(#?[%w]+);", function(ent)
    if ent:sub(1, 2) == "#x" or ent:sub(1, 2) == "#X" then return utf8.char(tonumber(ent:sub(3), 16) or 63) end
    if ent:sub(1, 1) == "#" then return utf8.char(tonumber(ent:sub(2)) or 63) end
    return NAMED[ent] or ("&" .. ent .. ";")
  end))
end

---@type Module
return {
  name = "ainews",
  icon = "sparkles",
  every = "5m",
  title = "AI news",
  config = { limit = 12 },

  ---@param ctx Ctx
  fetch = function(ctx)
    local r = ctx.http.get(ctx.env("NEWS_WEBHOOK_URL"), { timeout = 20 })
    local raw = (type(r) == "table" and r.items) or r
    local items = json.array({})
    for _, it in ipairs(type(raw) == "table" and raw or {}) do
      if #items >= ctx.config.limit then break end
      items[#items + 1] = {
        title = unescape(it.title or ""),
        summary = unescape(it.summary or ""),
        url = it.url,
        source = unescape(it.source),
        published_at = it.publishedAt or it.published_at,
      }
    end
    return { items = items, fetched_at = ctx.now() }
  end,

  -- Rendered by ui/index.tsx in the same style as the digest cards.
  component = "Headlines",
}
