import type { InstanceInfo } from "../protocol/InstanceInfo";
import type { Kind } from "../protocol/Kind";
import type { ServerMsg } from "../protocol/ServerMsg";
import type { Status } from "../protocol/Status";
import type { JsonValue } from "../serde_json/JsonValue";

export type WidgetNode = { type: string; props: Record<string, JsonValue>; children: WidgetNode[] };

export type InstanceSlice = {
  rev: number;
  kind: Kind;
  state: JsonValue | null;
  config: JsonValue;
  view: WidgetNode | null;
  component: string | null;
  status: Status | null;
};

/** `updating`: a new server build was deployed and this page is about to reload itself. */
export type ConnectionState = "connecting" | "online" | "offline" | "updating";

export type DataState = {
  connection: ConnectionState;
  lastMessageAt: number | null;
  catalog: InstanceInfo[];
  instances: Record<string, InstanceSlice>;
};

export const initialData: DataState = { connection: "connecting", lastMessageAt: null, catalog: [], instances: {} };

const emptySlice = (): InstanceSlice => ({ rev: 0, kind: "view", state: null, config: {}, view: null, component: null, status: null });

/** Applies one server message. Slices that did not change keep their identity, so only their frames re-render. */
export function reduce(s: DataState, msg: ServerMsg, now: number): DataState {
  const base = { ...s, lastMessageAt: now };
  switch (msg.type) {
    case "welcome": {
      const ids = new Set(msg.instances.map((i) => i.id));
      const instances = Object.fromEntries(Object.entries(s.instances).filter(([id]) => ids.has(id)));
      return { ...base, catalog: msg.instances, instances };
    }
    case "snapshot": {
      const cur = s.instances[msg.instance];
      const next: InstanceSlice =
        cur && cur.rev >= msg.rev
          ? { ...cur, status: msg.status }
          : {
              rev: msg.rev,
              kind: msg.kind,
              state: msg.state,
              config: msg.config,
              view: msg.view as WidgetNode | null,
              component: msg.component,
              status: msg.status,
            };
      return { ...base, instances: { ...s.instances, [msg.instance]: next } };
    }
    case "status": {
      const cur = s.instances[msg.instance] ?? emptySlice();
      return { ...base, instances: { ...s.instances, [msg.instance]: { ...cur, status: msg.status } } };
    }
    case "remove": {
      const { [msg.instance]: _removed, ...rest } = s.instances;
      return { ...base, instances: rest, catalog: s.catalog.filter((i) => i.id !== msg.instance) };
    }
    default:
      return base;
  }
}
