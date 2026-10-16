import type { ComponentType, ReactNode } from "react";
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
import { Ticker } from "./Ticker";

export type Send = (action: string, args?: JsonValue) => Promise<void>;

/** `ui.icon { name, size }`: size in px, as Lucide takes it; colored like the text around it. */
function IconWidget({ name, size = 20 }: { name?: string; size?: number }) {
  return <Icon name={name ?? ""} size={size} className="inline-block shrink-0" />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WIDGETS: Record<string, ComponentType<any>> = { icon: IconWidget, stat: Stat, ticker: Ticker, list: List, row: Row, clock: Clock, group: Group, gauge: Gauge, line: Line, bar: BarWidget, donut: Donut, text: Text, badge: Badge };

type Action = { command: string; args: JsonValue };
const isAction = (v: unknown): v is Action =>
  typeof v === "object" && v !== null && typeof (v as { command?: unknown }).command === "string";

/** Renders a Lua view tree. `on_*` props become handlers that send the named command. */
export function WidgetTree({ node, send }: { node: WidgetNode; send: Send }): ReactNode {
  const Widget = WIDGETS[node.type];
  if (!Widget) {
    return <p className="text-sm text-ink-muted">Unsupported widget: {node.type}</p>;
  }
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node.props ?? {})) {
    props[key] =
      key.startsWith("on_") && isAction(value)
        ? () => void send(value.command, value.args).catch((e: Error) => console.warn(`${value.command} failed: ${e.message}`))
        : value;
  }
  return (
    <Widget {...props}>
      {(node.children ?? []).map((child, i) => <WidgetTree key={i} node={child} send={send} />)}
    </Widget>
  );
}
