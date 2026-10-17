# Deploying with Dokku

One way to run the dashboard: a [Dokku](https://dokku.com) server with the Redis plugin, a staging
app and a production app. Nothing in the app depends on Dokku; it's a container that needs a Redis.

The examples use `dokku.example.com` for the server, `dashboard-next` for staging and `dashboard` for
production. Commands run on the server through Dokku's ssh user: `ssh dokku@dokku.example.com <command>`.

## Create the apps

```sh
ssh dokku@dokku.example.com apps:create dashboard-next
ssh dokku@dokku.example.com domains:set dashboard-next dashboard-next.example.com
ssh dokku@dokku.example.com ports:set dashboard-next http:80:5000   # the image listens on 5000
git remote add dokku-next dokku@dokku.example.com:dashboard-next
```

Production is the same with `dashboard` and a git remote named `dokku`.

## Redis

Give the dashboard its own Redis service with an append-only log, so state survives restarts:

```sh
ssh dokku@dokku.example.com redis:create dashboard-redis
# then in /var/lib/dokku/services/redis/dashboard-redis/config/redis.conf on the server:
#   appendonly yes / appendfsync everysec / maxmemory 256mb / maxmemory-policy noeviction
ssh dokku@dokku.example.com redis:restart dashboard-redis
ssh dokku@dokku.example.com redis:link dashboard-redis dashboard-next
```

Linking sets `REDIS_URL`. Staging and production can share the service with different
`REDIS_PREFIX` values, or each get their own.

## Settings

Everything is an environment variable:

```sh
ssh dokku@dokku.example.com config:set dashboard-next TZ=America/New_York DEFAULT_THEME=home
```

| Variable | |
|---|---|
| `TZ` | the zone schedules and "today" use (default UTC) |
| `DEFAULT_THEME` | the theme a screen opens without `?theme=` (default `home`) |
| `REDIS_PREFIX` | key prefix, when apps share a Redis |
| `HOOKS_TOKEN` | the token callers send to hooks with `auth = { token = "HOOKS_TOKEN" }`; unset means open, for local development only |
| `OPENWEATHERMAP_API_KEY` | weather |
| `FINNHUB_API_KEY` | stocks |
| `OPENROUTER_API_KEY` | modules using `lib/openrouter.lua`; `OPENROUTER_MODEL` sets their default model, `OPENROUTER_APP_NAME` and `OPENROUTER_APP_URL` how they identify themselves |
| `CALENDAR_<NAME>` | calendar panels with `feeds="<name>"`: one or more ICS URLs, comma-separated |

Modules from `local/` bring their own variables; set them the same way. Pass values with special
characters quoted for the remote shell, for example `config:set app KEY=$(printf %q "$VALUE")`.

## Deploy

```sh
bin/deploy           # staging (git remote dokku-next)
bin/deploy prod      # production (git remote dokku), after a confirmation
bin/logs             # tail staging's logs; bin/logs prod for production
```

`bin/deploy` pushes a commit built just for Dokku: the current commit plus your private extensions
gathered into `local/` (see [extending.md](../extending.md)). It force-pushes, since each deploy commit
is new; the repo's own history never includes it. Screens reload themselves when the new build is up.

## Behind a proxy or tunnel

Any reverse proxy in front of Dokku works, as long as it passes WebSockets through on `/ws`. If the
dashboard sits behind an authenticating proxy (Cloudflare Access, for example), hooks need a way
through it: a bypass rule for `/hooks/*`, a service token the caller sends, or calling the server on
the local network directly. `bin/hook` sends Cloudflare service-token headers when
`CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` are set.
