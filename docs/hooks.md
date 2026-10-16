# Hooks

Hooks let anything that can make an HTTP request push data to the dashboard: a cron job, a
workflow tool, a script on another machine. A module declares them, and the server routes
`POST /hooks/<instance>/<hook>` to its handler.

```lua
hooks = {
  say = {
    description = "Add a message to the echo panel, as if someone typed it.",
    auth = { token = "HOOKS_TOKEN" },
    schema = { type = "object", required = { "text" }, properties = { text = { type = "string" } } },
    example = { text = "Backup finished" },
    handle = function(ctx, req)
      return remember(ctx.state, req.body.text, ctx.config.keep, ctx.now())  -- the new state
    end,
  },
},
```

`handle` gets the decoded JSON body (and a few safe headers) and returns the new state, or nil to
leave it alone. Every screen showing the instance updates at once, even pages that are hidden.

A module with hooks and no `fetch` is push-only. It runs on its own without an entry in
`application.lua` and shows "Waiting for the first push" until something arrives.

## Auth

| `auth` | Caller sends |
|---|---|
| `{ token = "HOOKS_TOKEN" }` | `Authorization: Bearer <token>` or `X-Hook-Token: <token>`. When the variable is unset (local development) the hook is open. |
| `{ hmac = "sha256", header = "X-Signature", secret = "GITHUB_SECRET" }` | an HMAC of the body, as GitHub and most SaaS webhooks do. `encoding = "base64"` if they don't use hex. |
| `{ public = true }` | nothing. Only for data you don't mind anyone writing. |

Bodies are capped at 64 KiB and each instance accepts 60 requests a minute. Errors come back as
plain status codes (401, 404, 413, 429, 500) without internals.

## Discovering hooks

`GET /hooks` lists every hook; `GET /hooks/<instance>/<hook>` shows one hook's description, auth
type, schema and example (never secrets); `GET /hooks/openapi.json` is the same as OpenAPI 3.1.
An agent can read the contract and send a valid payload without anyone writing it down.

`bin/hook` wraps all of this:

```sh
bin/hook                                  # list hooks
bin/hook echo/say                         # describe one
echo '{"text":"Backup finished"}' | bin/hook echo/say -
```

It reads `DASHBOARD_URL` and `HOOKS_TOKEN` from your environment or `.env`, and sends Cloudflare
Access service-token headers when `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` are set.
