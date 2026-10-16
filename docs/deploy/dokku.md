# Deploying with Dokku

One way to deploy the dashboard: a Dokku host with the Redis plugin. Nothing in the server depends on it.

| Piece | Value |
|---|---|
| Host | `lab` (ssh alias), Dokku with the redis plugin |
| Staging app | `dashboard-next`, git remote `dokku-next`, `bin/deploy` |
| Production app | `dashboard`, git remote `dokku`, `bin/deploy prod` |
| Domain | `dashboard.example.com` via the existing cloudflared tunnel and Cloudflare Access |
| Redis | dedicated Dokku Redis service `dashboard-redis` with append-only persistence |

## First-time staging setup

    ssh lab dokku apps:create dashboard-next
    ssh lab dokku domains:set dashboard-next dashboard-next.example.com
    ssh lab dokku ports:set dashboard-next http:80:5000   # the image exposes 5000; serve it on 80
    git remote add dokku-next dokku@lab:dashboard-next

## Deploy and inspect

    bin/deploy           # staging
    bin/logs             # tail staging logs
    curl --resolve dashboard-next.example.com:80:192.168.1.10 http://dashboard-next.example.com/healthz

## Redis

A dedicated service, never the shared one: the shared Redis has no append-only log or memory limit.

    ssh lab dokku redis:create dashboard-redis
    # append to /var/lib/dokku/services/redis/dashboard-redis/config/redis.conf:
    #   appendonly yes / appendfsync everysec / maxmemory 256mb / maxmemory-policy noeviction
    ssh lab dokku redis:restart dashboard-redis
    ssh lab dokku redis:link dashboard-redis dashboard-next

## Production

The production app is `dashboard` (git remote `dokku`, domain dashboard.example.com behind Cloudflare Access). It was cut over
from the Python app on 2026-10-16; the last Python commit is tagged `python-final`. Deploy with:

    bin/deploy prod     # pushes the current branch to dokku:master and asks for confirmation

Staging is `dashboard-next` (remote `dokku-next`), `bin/deploy` with no argument.

## Settings

System settings are environment variables, never application.lua:

    ssh lab dokku config:set dashboard-next TZ=America/New_York   # cron schedules run in this zone (default UTC)

`PORT`, `REDIS_URL` and `REDIS_PREFIX` are set by Dokku and the Redis link.

## Secrets

Modules read API keys from the environment with `ctx.env("NAME")`:

| Module | Variable |
|---|---|
| weather | `OPENWEATHERMAP_API_KEY` |
| stocks | `FINNHUB_API_KEY` |
| todoist | `TODOIST_API_TOKEN` |
| news | `NEWS_SUMMARY_URL` (n8n summary webhook, called with `?q=<topic>&n=<count>`) |
| ainews | `NEWS_WEBHOOK_URL` (n8n headlines webhook) |
| calendar | `GOOGLE_CALENDAR_ICS_URL` (one or more ICS URLs, comma-separated) |
| hooks | `HOOKS_TOKEN`: the shared token callers send as `Authorization: Bearer <token>` (or `X-Hook-Token`) to hooks with `auth = { token = "HOOKS_TOKEN" }`, like slack. Unset means open, which is meant for local development only |

## Webhooks

A module declares its hooks in its own `module.lua` (`hooks = { name = { auth, description, schema, example, handle } }`). A push-only module (hooks, no `fetch`) that needs no required config also runs on its own, as an instance named after the module, so it needs no `application.lua` entry. `GET /hooks/openapi.json` is all of them as one OpenAPI 3.1 document. `GET /hooks` lists every hook; `GET /hooks/<instance>/<hook>` returns its contract: auth header, JSON schema and a
working example. `bin/hook` reads both and signs payloads for you. From the LAN, post straight to the lab
(`DASHBOARD_URL=http://192.168.1.10` with `-H 'Host: dashboard.example.com'`, or the hosts-file override the kiosk uses);
from outside, `dashboard.example.com/hooks/*` needs a Cloudflare Access rule (Bypass for HMAC-signed hooks).
