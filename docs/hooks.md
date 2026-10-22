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

## Push panels: `stats` and `upcoming`

Two shipped modules exist only to be pushed to: `stats` (numbers) and `upcoming` (a schedule). Each
instance is one panel, and its hook is `POST /hooks/<instance>/push`: `<Slot module="stats"
instance="work" />` takes pushes at `/hooks/stats:work/push`. A bare `<Slot module="stats" />` works
too, at `/hooks/stats/push`. Declare the instance in `application.lua` (`{ id = "stats:work" }`) so
pushes land even while no screen shows it.

Both authenticate with `Authorization: Bearer $HOOKS_TOKEN` and answer:

| Status | Meaning |
|---|---|
| `204` | applied; every screen showing the panel updates at once |
| `401` | missing or wrong token |
| `413` | body over 64 KB |
| `500` | the body didn't fit the shape below; the panel keeps what it had |

### Sources and replacing

Every push names a `source` (default `"default"`): who is sending, such as `slack`, `email` or `work`.

- A push **replaces that source's** stats or events, and keeps every other source's. Senders on
  different schedules share one panel without overwriting each other.
- Send **everything that source has** each time: anything of that source left out disappears.
- An empty `stats` (`{}`) or `events` (`[]`) **clears that source**.
- `"replace": true` makes the push **the whole panel**: every other source is dropped as well.

### `stats`: numbers

```json
{
  "source": "slack",
  "replace": false,
  "stats": {
    "@ mentions": { "number": 3, "icon": "at-sign", "tone": "warn" },
    "Unread":     { "number": 12, "icon": "inbox" }
  }
}
```

`stats` maps a label (shown as written) to:

| Field | Required | Meaning |
|---|---|---|
| `number` | yes | the figure shown large; any JSON number, shown as sent |
| `icon` | | a [Lucide](https://lucide.dev/icons) icon name |
| `tone` | | `accent`, `good`, `warn` or `bad`: the figure's color |
| `sub` | | one short line under the figure |
| `order` | | sort key, lower first (default 1000); then by label |
| `ring` | | ring the bell when the number goes up (`tone: "bad"` always does) |

The grid fills the panel: its columns and rows follow the number of tiles and the panel's shape, and
each number grows with its tile. A panel shows at most 9 tiles (the first by `order`; a slot's `max`
changes it). A number that goes up pops.

Labels, `sub` lines and event titles take light markdown: `**bold**`, `*italic*`, `__underline__`,
`~~strike~~` and `` `code` ``. Anything else shows as typed.

### `upcoming`: a schedule

```json
{
  "source": "work",
  "replace": false,
  "events": [
    { "title": "Meeting", "at": "2026-10-20T10:00:00-04:00", "end": "2026-10-20T10:30:00-04:00", "icon": "users" },
    { "title": "1:1",     "at": 1792504800, "end": 1792506600 }
  ]
}
```

Each event:

| Field | Required | Meaning |
|---|---|---|
| `title` | yes | what it is |
| `at` | yes | start: ISO 8601 with an offset or `Z` (without one, the server's `TZ`), or unix seconds |
| `end` | | end, in the same forms; lets the panel say "now · 20m left", then drop it |
| `icon` | | a Lucide icon name |
| `sub` | | one short line, e.g. a room |

Order doesn't matter. Push a whole day at once: the panel counts down to the next event, shows
"now" while one is on, and rolls on as each ends. Events that are over are dropped (one with no `end`
ten minutes after it starts).

### Keeping private data private

The dashboard shows what it's sent, so a sender on another network (a work laptop, say) should send
glances, not content: counts under labels of its own choosing, and meetings as times with a generic
title (`Meeting`, `1:1`, `External`, `Focus`) rather than subjects, attendees or links. The relay and
the hooks keep no request bodies in their logs.
