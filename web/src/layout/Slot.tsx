import { useContext, useEffect } from "react";
import { ModuleFrame, type Chrome, type Density } from "../components/ModuleFrame";
import { declareSlot } from "../data/slots";
import { flexFor, type Size } from "./Containers";
import { PageVisible } from "./Pages";

const FRAME_PROPS = new Set(["module", "instance", "id", "title", "icon", "size", "chrome", "area", "component"]);
const DENSITIES = new Set(["compact", "normal", "large"]);

type SlotProps = {
  module?: string;
  instance?: string;
  id?: string;
  /** Template over config, state and status, e.g. "Home ({{config.zip}})". Overrides the module default. */
  title?: string;
  /** "compact" | "normal" | "large" for density, or a layout size like "30%" / "8rem" / 2. */
  size?: Size;
  chrome?: Chrome;
  area?: string;
  /** Header icon (a Lucide name, or "redis"); overrides the module's default. */
  icon?: string;
  /** Another exported component of the module's ui/index.tsx, e.g. "TodoistList". */
  component?: string;
  /** Anything else is a config prop for the module (zip, units, poll, ...). */
  [config: string]: unknown;
};

/** Places an instance and declares it to the server while mounted. */
export function Slot(props: SlotProps) {
  const { module, instance, id, title, icon, size, chrome, area, component } = props;
  const resolved = id ?? (module ? (instance ? `${module}:${instance}` : module) : "?");
  const mod = module ?? resolved.split(":")[0];
  const config = Object.fromEntries(Object.entries(props).filter(([k]) => !FRAME_PROPS.has(k)));
  const configKey = JSON.stringify(config);
  // Hidden pages keep their slots declared but idle; showing the page re-declares them as visible.
  const visible = useContext(PageVisible);
  useEffect(() => declareSlot(resolved, mod, JSON.parse(configKey), visible), [resolved, mod, configKey, visible]);
  const density: Density = typeof size === "string" && DENSITIES.has(size) ? (size as Density) : "normal";
  const layoutSize = density !== "normal" || size === "normal" ? undefined : size;
  return (
    <div style={{ ...flexFor(layoutSize), gridArea: area }} className="flex min-h-0 min-w-0 flex-col">
      <ModuleFrame id={resolved} title={title} icon={icon} density={density} chrome={chrome} component={component} />
    </div>
  );
}
