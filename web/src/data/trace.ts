import type { ClientMsg } from "../protocol/ClientMsg";
import type { ServerMsg } from "../protocol/ServerMsg";

/** Console tracing of every websocket message: `?debug=1` or `localStorage.dashboardDebug = "1"`. */
export function isTracing(): boolean {
  try {
    if (new URLSearchParams(location.search).get("debug") === "1") return true;
    return localStorage.getItem("dashboardDebug") === "1";
  } catch {
    return false;
  }
}

function label(m: ClientMsg | ServerMsg): string {
  const i = "instance" in m ? ` ${m.instance}` : "";
  const r = "rev" in m ? ` rev=${m.rev}` : "";
  const n = m.type === "watch" ? ` (${m.slots.length} slots)` : m.type === "welcome" ? ` (${m.instances.length} instances)` : "";
  return `${m.type}${i}${r}${n}`;
}

export function trace(direction: "→" | "←", msg: ClientMsg | ServerMsg) {
  if (!isTracing()) return;
  console.debug(`%c${direction} ${label(msg)}`, direction === "→" ? "color:#8b7cf8" : "color:#73bf69", msg);
}
