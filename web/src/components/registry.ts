import { lazy, type ComponentType } from "react";
import type { JsonValue } from "../serde_json/JsonValue";
import type { Status } from "../protocol/Status";
import type { Send } from "../widgets/WidgetTree";
import type { Density } from "./ModuleFrame";
import { importOrReload } from "../data/chunks";
import { moduleUis } from "virtual:dashboard/extensions";

/** What a module's custom component receives. `state` is the module's latest state, `config` the instance config. */
export type CustomProps = {
  state: JsonValue | null;
  config: Record<string, JsonValue>;
  status: Status | null;
  send: Send;
  title: string;
  density: Density;
};

type Loader = () => Promise<Record<string, unknown>>;

/*
 * Custom components live in `<modules folder>/<name>/ui/index.tsx` and are discovered at build time
 * across every MODULES_DIR folder (see plugins/extensions.ts). A module's `component = "Weather"`
 * names an export of that file.
 */
const loaders: Record<string, Loader> = moduleUis;

const cache = new Map<string, ComponentType<CustomProps>>();

/** Registers a component directly; tests use this instead of the file glob. */
export function registerComponent(module: string, name: string, component: ComponentType<CustomProps>) {
  cache.set(`${module}/${name}`, component);
}

/** The component for `module`'s `name`, loaded lazily, or null when the module ships no such UI. */
export function customComponent(module: string, name: string): ComponentType<CustomProps> | null {
  const key = `${module}/${name}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const load = loaders[module];
  if (!load) return null;
  const Lazy = lazy(async () => {
    const exports = await importOrReload(load);
    const found = exports[name];
    if (typeof found !== "function") throw new Error(`modules/${module}/ui/index.tsx exports no component named ${name}`);
    return { default: found as ComponentType<CustomProps> };
  });
  cache.set(key, Lazy);
  return Lazy;
}
