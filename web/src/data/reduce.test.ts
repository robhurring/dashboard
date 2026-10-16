import { describe, expect, test } from "vitest";
import { initialData, reduce } from "./reduce";
import type { ServerMsg } from "../protocol/ServerMsg";
import type { Status } from "../protocol/Status";

const ok: Status = { ok: true, fetched_at: 1, pushed_at: null, writer: null, error: null, retry_at: null, loading: false, load_error: null };
const view = { type: "stat", props: { value: "1" }, children: [] };
const snap = (rev: number, value = String(rev)): ServerMsg => ({
  type: "snapshot", instance: "w", rev, kind: "view", view: { ...view, props: { value } }, state: null, config: {}, component: null, status: ok,
});

describe("reduce", () => {
  test("welcome sets the catalog and drops instances no longer listed", () => {
    let s = reduce(initialData, snap(1), 0);
    s = reduce(s, { type: "welcome", server: "0.1.0", protocol: 1, instances: [{ id: "x", module: "m", kind: "view", component: null, title: null, icon: null, push_only: false }] }, 1);
    expect(s.catalog.map((i) => i.id)).toEqual(["x"]);
    expect(s.instances.w).toBeUndefined();
    expect(s.lastMessageAt).toBe(1);
  });

  test("snapshots replace a slice only when newer", () => {
    let s = reduce(initialData, snap(2, "two"), 0);
    s = reduce(s, snap(1, "one"), 0);
    expect(s.instances.w.rev).toBe(2);
    expect(s.instances.w.view?.props.value).toBe("two");
    s = reduce(s, snap(3, "three"), 0);
    expect(s.instances.w.view?.props.value).toBe("three");
  });

  test("unchanged slices keep their identity", () => {
    let s = reduce(initialData, snap(1), 0);
    s = reduce(s, { ...snap(1), instance: "other" } as ServerMsg, 0);
    const before = s.instances.w;
    s = reduce(s, { ...snap(2), instance: "other" } as ServerMsg, 0);
    expect(s.instances.w).toBe(before);
  });

  test("status updates and removal", () => {
    let s = reduce(initialData, snap(1), 0);
    s = reduce(s, { type: "status", instance: "w", status: { ...ok, ok: false, error: "down" } }, 0);
    expect(s.instances.w.status?.error).toBe("down");
    expect(s.instances.w.rev).toBe(1);
    s = reduce(s, { type: "status", instance: "ghost", status: { ...ok, load_error: "no module" } }, 0);
    expect(s.instances.ghost.rev).toBe(0);
    s = reduce(s, { type: "remove", instance: "w" }, 0);
    expect(s.instances.w).toBeUndefined();
  });
});
