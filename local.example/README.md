# local/

Your own modules, themes and widgets: whatever is specific to your screens. The dashboard reads this
folder before its own (`local/modules` before `modules`, and so on), so anything here can also replace
a built-in by using its name. The repo ignores `local/`, so nothing here is ever committed upstream,
and `git pull` never conflicts with it.

```
local/
  modules/<name>/module.lua   a module; add ui/index.tsx for a custom component
  themes/<name>/index.tsx     a theme; start from a copy of web/themes/home
  widgets/<name>.tsx          a widget, used in Lua views as ui.<name>
  application.lua             instances that run with no screen open
  tests/*.rs                  Rust tests for your modules, run by bin/test
```

To keep it safe and in sync across machines, make it a private git repo:

```sh
cd local
git init && git add -A && git commit -m "My dashboard extensions"
gh repo create dashboard-local --private --source . --push
```

Then set `LOCAL_REPO=git@github.com:you/dashboard-local.git` in the dashboard's `.env`, and `bin/setup`
clones it on a new machine. `bin/deploy` ships whatever is here.

See [docs/extending.md](../docs/extending.md) for the details, and [docs/modules.md](../docs/modules.md)
to write a module. This folder started as a copy of `local.example/` in the dashboard repo.
