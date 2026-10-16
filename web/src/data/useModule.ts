import { useCallback } from "react";
import type { JsonValue } from "../serde_json/JsonValue";
import { getLive } from "./live";
import { useData } from "./store";

/** One instance's slice of the store, plus ways to talk back to it. */
export function useModule(id: string) {
  const slice = useData((s) => s.instances[id]);
  const info = useData((s) => s.catalog.find((i) => i.id === id));
  const send = useCallback((action: string, args?: JsonValue) => getLive().command(id, action, args ?? {}), [id]);
  const refresh = useCallback(() => getLive().refresh(id), [id]);
  return { info, slice, send, refresh };
}
