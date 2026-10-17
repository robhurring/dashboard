# Extending

The dashboard ships a standard set of modules, a default theme and the built-in widgets. Everything
specific to one home, like a panel for a service only you run, your own layout, or a widget for
your garden sensors, belongs in your own folder, usually a private git repo. The build pulls it in,
deploys ship it, and none of it is committed to this repo.

## The local/ folder

By default the dashboard also looks in `local/`, which this repo ignores:

```
local/
  modules/<name>/        modules, same shape as modules/: module.lua, optional ui/ and sibling .lua files
  themes/<name>/         themes: index.tsx and tokens.css
  widgets/<name>.tsx     custom widgets, usable in Lua views as ui.<name>
  lib/<name>.lua         shared Lua libraries any module can require("<name>")
  application.lua        optional: replaces the repo's application.lua
  tests/*.rs             optional: Rust tests for your modules, run by bin/test
```

`bin/setup` creates it from `local.example/`, a starter copy with a README and an example
`application.lua`. Make it a git repo of its own and push it somewhere private:

```sh
mkdir -p local/modules local/themes local/widgets
cd local && git init && git add -A && git commit -m "My dashboard extensions"
gh repo create dashboard-local --private --source . --push
```

On another machine, set `LOCAL_REPO=git@github.com:you/dashboard-local.git` in `.env` and
`bin/setup` clones it into `local/`.

## Folders anywhere

The folder lists are settings, colon-separated, and searched like `$PATH`: the first folder that
has a given name wins. `local/` comes first by default, so `local/modules/weather` replaces the stock
`weather` module, UI included.

| Setting | Default |
|---|---|
| `MODULES_DIR` | `local/modules:modules` |
| `THEMES_DIR` | `local/themes:web/themes` |
| `WIDGETS_DIR` | `local/widgets` |
| `LIBS_DIR` | `local/lib:lib` |
| `APPLICATION_FILE` | `local/application.lua` if it exists, else `application.lua` |
| `DEFAULT_THEME` | `home` |

Point them at other folders to keep extensions somewhere else, for example
`MODULES_DIR=/Users/me/code/garden/modules:local/modules:modules`. Relative paths are from the repo root. The
server and the web build read the same settings, from the environment or `.env`.

## Themes

Start from a copy of `web/themes/home`. Import app pieces through the `@dashboard` alias, which works
from any folder:

```tsx
import "./tokens.css";
import { Column, Page, Pages, Row, Slot } from "@dashboard/layout";
```

Set `DEFAULT_THEME` to its folder name to open with it. It's read when the page is served, so on a
server it's an ordinary environment setting (`dokku config:set ... DEFAULT_THEME=mine`).

## Widgets

A widget is a React component in `local/widgets/<name>.tsx` (or `<name>/index.tsx`) with a default
export. Its file name becomes `ui.<name>` in Lua; names are lowercase letters, digits and `_`, and
can't reuse a built-in name.

```tsx
// local/widgets/soil.tsx
export default function Soil({ moisture, label }: { moisture: number; label?: string }) {
  return <div className="type-hero">{moisture}%<span className="type-sub"> {label}</span></div>;
}
```

```lua
view = function(state)
  return ui.group { direction = "row", ui.soil { moisture = state.bed1, label = "Bed 1" }, ui.soil { moisture = state.bed2, label = "Bed 2" } }
end,
```

A widget gets the props the view gives it, its children already rendered, and any `on_*` prop
turned into a function that runs that command. Restart the server after adding a new widget so
views can use its name.

## Deploying

`bin/deploy` builds the commit it pushes to Dokku from the current commit plus every extension
folder, gathered into `local/`. The Docker image builds whatever `local/` holds, so production gets
your modules, themes and widgets without them ever entering this repo's history. `DEPLOY_DRY_RUN=1
bin/deploy` lists what would ship.

A plain `docker build` works the same way: whatever is in `local/` at build time is included.

## Tests

`bin/test` runs the tests that live in `local/` too: `*.test.tsx` files next to your components, and
Rust tests in `local/tests/`, which it links into the server's tests before running cargo. Rust
tests load your modules from `../local/modules/<name>/module.lua`, relative to the server crate.
