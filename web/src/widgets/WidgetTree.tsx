import { Suspense, lazy, type ComponentType, type ReactNode } from "react";
import { widgets as customWidgets } from "virtual:dashboard/extensions";
import type { WidgetNode } from "../data/reduce";
import type { JsonValue } from "../serde_json/JsonValue";
import { BarWidget, Donut, Gauge, Line } from "./Charts";
import { Clock } from "./Clock";
import { Group } from "./Group";
import { Icon } from "./icons";
import { List } from "./List";
import { Row } from "./Row";
import { Stat } from "./Stat";
import { Badge, Text } from "./Text";
import { Markdown } from "./Markdown";
import { AudioWidget, ImageWidget } from "./Media";
import { Progress } from "./Progress";
import { Button, Choice, Slider, Toggle } from "./Controls";
import { Ticker } from "./Ticker";

export type Send = (action: string, args?: JsonValue) => Promise<void>;

/** `ui.icon { name, size }`: size in px, as Lucide takes it; colored like the text around it. */
function IconWidget({ name, size = 20 }: { name?: string; size?: number }) {
  return <Icon name={name ?? ""} size={size} className="inline-block shrink-0" />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WIDGETS: Record<string, ComponentType<any>> = { icon: IconWidget, stat: Stat, ticker: Ticker, list: List, row: Row, clock: Clock, group: Group, gauge: Gauge, line: Line, bar: BarWidget, donut: Donut, text: Text, markdown: Markdown, badge: Badge, image: ImageWidget, audio: AudioWidget, progress: Progress, button: Button, toggle: Toggle, slider: Slider, choice: Choice };

/*
 * Custom widgets: files in the WIDGETS_DIR folders (local/widgets by default), each default-exporting a
 * component that becomes `ui.<file name>` in Lua. Loaded the first time a view uses one.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const custom = new Map<string, ComponentType<any>>();

/** Registers a widget directly; tests use this instead of the folder scan. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerWidget(name: string, component: ComponentType<any>) {
  custom.set(name, component);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function customWidget(name: string): ComponentType<any> | null {
  const hit = custom.get(name);
  if (hit) return hit;
  const load = customWidgets[name];
  if (!load) return null;
  const Lazy = lazy(async () => {
    const mod = await load();
    if (typeof mod.default !== "function") throw new Error(`widget ${name} has no default export`);
    return { default: mod.default as ComponentType<unknown> };
  });
  custom.set(name, Lazy);
  return Lazy;
}

type Action = { command: string; args: JsonValue };
const isAction = (v: unknown): v is Action =>
  typeof v === "object" && v !== null && typeof (v as { command?: unknown }).command === "string";

/**
 * What an `on_*` prop becomes: a function that runs the command. A control passes its new value, which
 * joins the command's args as `value`. It resolves to null when the command succeeded, or its error.
 */
export type Handler = (value?: JsonValue) => Promise<string | null>;

function handler(send: Send, action: Action): Handler {
  return (raw) => {
    // A widget may pass its click event straight through (onClick={on_tap}); that isn't a value.
    const isEvent = typeof raw === "object" && raw !== null && ("nativeEvent" in raw || (typeof Event !== "undefined" && raw instanceof Event));
    const value = isEvent ? undefined : raw;
    const base = action.args && typeof action.args === "object" && !Array.isArray(action.args) ? action.args : {};
    const args = value === undefined ? action.args : ({ ...base, value } as JsonValue);
    return send(action.command, args).then(
      () => null,
      (e: Error) => {
        console.warn(`${action.command} failed: ${e.message}`);
        return e.message;
      },
    );
  };
}

/** Renders a Lua view tree. `on_*` props become handlers that send the named command. */
export function WidgetTree({ node, send }: { node: WidgetNode; send: Send }): ReactNode {
  const Widget = WIDGETS[node.type] ?? customWidget(node.type);
  if (!Widget) {
    return <p className="text-sm text-ink-muted">Unsupported widget: {node.type}</p>;
  }
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node.props ?? {})) {
    props[key] =
      key.startsWith("on_") && isAction(value)
        ? handler(send, value)
        : value;
  }
  const children = (node.children ?? []).map((child, i) => <WidgetTree key={i} node={child} send={send} />);
  if (WIDGETS[node.type]) return <Widget {...props}>{children}</Widget>;
  return (
    <Suspense fallback={null}>
      <Widget {...props}>{children}</Widget>
    </Suspense>
  );
}
