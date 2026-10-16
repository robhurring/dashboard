import { LiveConnection, type SocketLike } from "./connection";
import { currentDeclarations, onDeclarationsChange } from "./slots";
import { useData } from "./store";
import { DemoConnection, isDemo } from "./demo";

type Connection = Pick<LiveConnection, "command" | "refresh" | "rewatch" | "start">;

let live: Connection | null = import.meta.hot?.data?.live ?? null;

/** The app's single connection, created on first use and kept across hot updates. */
export function getLive(): Connection {
  if (live) return live;
  if (isDemo()) {
    live = new DemoConnection((m) => useData.getState().apply(m));
    live.start();
    useData.getState().setConnection("online");
    return live;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const screen = new URLSearchParams(location.search).get("screen") ?? "browser";
  live = new LiveConnection({
    url: `${proto}://${location.host}/ws`,
    screen,
    createSocket: (u) => new WebSocket(u) as unknown as SocketLike,
    apply: (m) => useData.getState().apply(m),
    setConnection: (c) => useData.getState().setConnection(c),
    getRevs: () => Object.fromEntries(Object.entries(useData.getState().instances).map(([id, s]) => [id, s.rev])),
    getSlots: currentDeclarations,
    reload: (why) => {
      console.info(`[dashboard] reloading: ${why}`);
      useData.getState().setConnection("updating");
      // A beat for the banner to paint, then fetch the new build.
      setTimeout(() => location.reload(), 600);
    },
  });
  live.start();
  onDeclarationsChange(() => live?.rewatch());
  if (import.meta.hot?.data) import.meta.hot.data.live = live;
  return live;
}
