import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { ServerMsg } from "../protocol/ServerMsg";
import { initialData, reduce, type ConnectionState, type DataState } from "./reduce";

type Store = DataState & {
  apply: (msg: ServerMsg) => void;
  setConnection: (c: ConnectionState) => void;
};

/** Names each store update for the Redux DevTools extension: "snapshot weather:home", "status stocks", ... */
function actionName(msg: ServerMsg): string {
  return "instance" in msg ? `${msg.type} ${msg.instance}` : msg.type;
}

function createStore() {
  return create<Store>()(
    devtools(
      (set) => ({
        ...initialData,
        apply: (msg) => set((s) => reduce(s, msg, Date.now()), false, actionName(msg)),
        setConnection: (connection) => set({ connection }, false, `connection ${connection}`),
      }),
      { name: "dashboard", enabled: import.meta.env.DEV },
    ),
  );
}

// Keep one store across hot updates so editing code never drops live data.
export const useData: ReturnType<typeof createStore> = import.meta.hot?.data?.useData ?? createStore();
if (import.meta.hot?.data) import.meta.hot.data.useData = useData;
