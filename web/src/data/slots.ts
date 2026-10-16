import type { SlotDecl } from "../protocol/SlotDecl";
import type { JsonValue } from "../serde_json/JsonValue";

type Entry = { id: string; module: string; props: Record<string, JsonValue>; visible: boolean; seq: number };
const entries = new Map<number, Entry>();
let seq = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function isJson(v: unknown): v is JsonValue {
  if (v === null || ["string", "number", "boolean"].includes(typeof v)) return true;
  if (Array.isArray(v)) return v.every(isJson);
  if (typeof v === "object") return Object.values(v as object).every(isJson);
  return false;
}

function notify() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    for (const l of listeners) l();
  }, 50);
}

/**
 * Registers a mounted slot. `visible` is whether its page is on screen: hidden slots stay declared
 * (their updates and hook pushes still arrive) but do not make the module poll. Returns the unregister
 * function for the effect cleanup.
 */
export function declareSlot(id: string, module: string, props: Record<string, unknown>, visible = true): () => void {
  const clean: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (isJson(v)) clean[k] = v;
    else console.warn(`<Slot ${id}> prop "${k}" is not JSON and was not sent`);
  }
  const key = ++seq;
  entries.set(key, { id, module, props: clean, visible, seq: key });
  notify();
  return () => {
    entries.delete(key);
    notify();
  };
}

/** One declaration per id, the earliest mount's props winning, visible if any mount is visible. */
export function currentDeclarations(): SlotDecl[] {
  const byId = new Map<string, Entry>();
  const visible = new Map<string, boolean>();
  for (const e of [...entries.values()].sort((a, b) => a.seq - b.seq)) {
    if (!byId.has(e.id)) byId.set(e.id, e);
    visible.set(e.id, (visible.get(e.id) ?? false) || e.visible);
  }
  return [...byId.values()].map(({ id, module, props }) => ({ id, module, props, visible: visible.get(id) ?? true }));
}

export function onDeclarationsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
