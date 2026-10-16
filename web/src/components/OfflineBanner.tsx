import { useEffect, useState } from "react";
import { useData } from "../data/store";

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function OfflineBanner() {
  const connection = useData((s) => s.connection);
  const last = useData((s) => s.lastMessageAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (connection === "online") return;
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, [connection]);

  if (connection === "online") return null;
  if (connection === "updating") {
    return (
      <div role="status" className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-accent/90 px-4 py-2 text-center text-sm text-canvas">
        <span className="size-3 animate-spin rounded-full border-2 border-canvas/40 border-t-canvas" />
        Updating the dashboard…
      </div>
    );
  }
  const text =
    connection === "connecting"
      ? "Connecting…"
      : `Offline. ${last ? `Last update ${ago(now - last)}. ` : ""}Reconnecting…`;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 bg-bad/90 px-4 py-2 text-center text-sm text-white">
      {text}
    </div>
  );
}
