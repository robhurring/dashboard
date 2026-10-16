-- Things that always run, regardless of what any screen shows: push-only instances with their hook
-- settings, and anything no theme places. Screens declare everything else with <Slot>.
-- System settings (time zone, ports, Redis) come from the environment: see .env.example.
return {
  -- Push-only modules with no required config (like slack) need no entry here: they run on their own.
  instances = {},
}
