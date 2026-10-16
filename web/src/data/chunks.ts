/**
 * Loads a lazily imported chunk. If it fails (the page is older than the server's build, so its
 * chunk names no longer exist), reload once to fetch the new build. A second failure within a
 * minute is a real error and is thrown, so a broken deploy cannot cause a reload loop.
 */
const KEY = "dashboard.chunk-reload-at";
const WINDOW_MS = 60_000;

export function importOrReload<T>(load: () => Promise<T>, reload: () => void = () => location.reload()): Promise<T> {
  return load().catch((err: unknown) => {
    let last = 0;
    try { last = Number(sessionStorage.getItem(KEY) ?? 0); } catch { /* storage unavailable */ }
    if (Date.now() - last < WINDOW_MS) throw err;
    try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* storage unavailable */ }
    console.info("[dashboard] a chunk failed to load; reloading for the new build", err);
    reload();
    return new Promise<T>(() => {}); // the page is going away
  });
}
