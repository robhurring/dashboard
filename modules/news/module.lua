-- A markdown news summary for one topic from the n8n summary webhook: GET {NEWS_SUMMARY_URL}?q=<topic>&n=<count>.
---@type Module
return {
  name = "news",
  icon = "newspaper",
  every = "30m",
  title = "News · {{config.topic}}",
  config = {
    topic = required,   -- e.g. <Slot module="news" instance="ai" topic="ai" />
    count = 5,          -- articles the summary should draw on
  },

  ---@param ctx Ctx
  fetch = function(ctx)
    local r = ctx.http.get(ctx.env("NEWS_SUMMARY_URL"), { query = { q = ctx.config.topic, n = ctx.config.count }, timeout = 60 })
    if type(r) == "table" and r[1] ~= nil then r = r[1] end
    local markdown = type(r) == "table" and r.output or r
    return { topic = ctx.config.topic, markdown = tostring(markdown or ""), fetched_at = ctx.now() }
  end,

  -- Rendered by ui/index.tsx: the digest's sections and items, with source links as chips.
  component = "News",
}
