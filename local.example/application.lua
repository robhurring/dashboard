-- Instances that run whether or not any screen shows them. Screens declare everything else with <Slot>.
-- Push-only modules (hooks and no fetch) need no entry: they run on their own.
return {
  instances = {
    -- { id = "calendar:everyone", module = "calendar", feeds = "home", poll = "always" },
  },
}
