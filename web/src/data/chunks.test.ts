import { beforeEach, describe, expect, test, vi } from "vitest";
import { importOrReload } from "./chunks";

beforeEach(() => { sessionStorage.clear(); });

describe("importOrReload", () => {
  test("passes a successful import through", async () => {
    const reload = vi.fn();
    await expect(importOrReload(async () => ({ default: 1 }), reload)).resolves.toEqual({ default: 1 });
    expect(reload).not.toHaveBeenCalled();
  });

  test("a failed chunk import reloads the page once; a second failure soon after surfaces the error", async () => {
    const reload = vi.fn();
    const failing = () => Promise.reject(new TypeError("Failed to fetch dynamically imported module"));
    const pending = importOrReload(failing, reload);
    await Promise.resolve(); await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
    void pending; // never settles: the page is reloading
    await expect(importOrReload(failing, reload)).rejects.toThrow("dynamically imported");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
