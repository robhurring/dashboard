# Themes and layout

A theme is a folder with an `index.tsx` (the layout) and a `tokens.css` (colors and font). The repo
ships `home` (the default) and `gallery` (every widget, for reference) in `web/themes/`; your own go
in `local/themes/` or any folder in `THEMES_DIR`. `?theme=<name>` picks one, and `DEFAULT_THEME`
sets the one that opens without it. Import app pieces through `@dashboard/...` so a theme works
from any folder.

## Pages

```tsx
<Pages home="tasks" returnHomeAfter="5m">
  <Page id="tasks" title="Tasks">...</Page>
  <Page id="glance" title="Glance">...</Page>
</Pages>
```

Pages sit side by side and move one at a time: swipe, use the arrow keys, or click the dots. With
`returnHomeAfter`, the screen goes back to `home` after that long without a touch. The current
page survives a reload.

A page that isn't showing keeps its data live (pushes still arrive) but stops its modules from
polling. Showing it again fetches anything that went stale while it was away.

## Rows, columns and grids

`<Row>` and `<Column>` split the space evenly; give a child `size` to change its share (`2` for
twice as much, or a length like `"40%"`). `<Grid areas={[...]} columns="..." rows="...">` is a CSS
grid with named areas, for layouts rows and columns can't express; place a slot with `area`.

## Slot

```tsx
<Slot module="weather" instance="home" zip="10001" title="Home · {{state.place}}" chrome="full" />
```

| Prop | |
|---|---|
| `module` | which module |
| `instance` | names this copy; the instance id becomes `module:instance` |
| `title` | header text, a template over `config`, `state` and `status` |
| `icon` | header icon, overriding the module's |
| `size` | `"compact"`, `"normal"` or `"large"` text, or a layout share as above |
| `chrome` | `"full"` (header and frame), `"minimal"` or `"none"` |
| `component` | another component exported by the module's `ui/index.tsx` |
| `poll="always"` | keep fetching even when no screen shows it |
| anything else | config for the module (`zip`, `days`, `symbols`...) |

Slots declare their instance to the server while they're mounted; nothing else needs to know
about them. `application.lua` is only for instances that must run with no screen open.

## Tokens

`tokens.css` sets the theme's palette as CSS variables: `--t-canvas`, `--t-panel`, `--t-ink`,
`--t-ink-muted`, `--t-accent`, the `good`/`warn`/`bad` tones, the sticky-note papers and the font.
The root font size follows the viewport, so a layout drawn for the 1280×720 kiosk scales to any
screen.
