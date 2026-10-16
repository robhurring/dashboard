import { useEffect, useRef, useState } from "react";
import type { CustomProps } from "@dashboard/components/registry";
import { Icon } from "@dashboard/widgets/icons";
import "./slack.css";

type Item = { label: string; number: number; tone?: "accent" | "good" | "warn" | "bad"; icon?: string; sub?: string; ring?: boolean };
type Motion = "none" | "pop" | "ring";
/** How long a tile keeps its motion class; the longest animation (the glow) fits inside. */
const MOTION_MS = 2300;

/**
 * Which tiles moved since the last push: a number that went up pops, and if the tile is urgent
 * (tone bad, or `ring: true`) its bell rings instead. Nothing moves on the first push.
 */
function useMotion(items: Item[]): Record<string, { motion: Motion; key: number }> {
  const previous = useRef<Map<string, number> | null>(null);
  const [motions, setMotions] = useState<Record<string, { motion: Motion; key: number }>>({});
  useEffect(() => {
    const before = previous.current;
    previous.current = new Map(items.map((it) => [it.label, it.number]));
    if (!before) return;
    const moved: Record<string, { motion: Motion; key: number }> = {};
    for (const it of items) {
      const was = before.get(it.label);
      if (was === undefined || it.number <= was) continue;
      moved[it.label] = { motion: it.tone === "bad" || it.ring ? "ring" : "pop", key: Date.now() };
    }
    if (Object.keys(moved).length === 0) return;
    setMotions((m) => ({ ...m, ...moved }));
    const t = setTimeout(() => setMotions((m) => {
      const next = { ...m };
      for (const label of Object.keys(moved)) if (next[label]?.key === moved[label].key) delete next[label];
      return next;
    }), MOTION_MS);
    return () => clearTimeout(t);
  }, [items]);
  return motions;
}
type State = { items: Item[]; pushed_at: number };

const EMPTY: Item[] = [];
const TONE: Record<string, string> = { accent: "text-accent", good: "text-good", warn: "text-warn", bad: "text-bad" };

function ago(secs: number): string {
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/** One tile per pushed label: icon, the number large, the label and an optional line. */
export function SlackStats({ state }: CustomProps) {
  const s = state as State | null;
  const motions = useMotion(s?.items ?? EMPTY);
  if (!s) return <p className="type-sub italic">Waiting for the first push</p>;
  const age = Math.max(0, Math.floor(Date.now() / 1000) - s.pushed_at);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {s.items.length === 0 ? (
        <p className="type-sub italic">Nothing to report</p>
      ) : (
        <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(7em,1fr))] gap-[0.75em] overflow-y-auto">
          {s.items.map((it) => {
            const m = motions[it.label];
            const motion: Motion = m?.motion ?? "none";
            return (
            <li key={it.label} data-motion={motion} className={`min-w-0 rounded-lg bg-ink/5 px-[0.75em] py-[0.6em] ${motion === "ring" ? "slack-ring-tile" : ""}`}>
              <div className="flex items-center gap-[0.4em] text-ink-muted">
                {it.icon && (
                  <span key={motion === "ring" ? m!.key : "still"} className={`inline-flex ${motion === "ring" ? "slack-ring-icon" : ""}`}>
                    <Icon name={it.icon} className={`size-[1.1em] shrink-0 ${it.tone ? TONE[it.tone] : "text-accent"}`} />
                  </span>
                )}
                <span className="type-sub truncate">{it.label}</span>
              </div>
              <div className={`type-value mt-[0.2em] ${it.tone ? TONE[it.tone] : ""}`}>
                <span key={motion === "none" ? "still" : m!.key} className={motion === "none" ? "" : "slack-pop"}>{it.number}</span>
              </div>
              {it.sub && <div className="type-sub mt-[0.15em] truncate">{it.sub}</div>}
            </li>
            );
          })}
        </ul>
      )}
      <div className="type-sub mt-[0.5em] shrink-0 text-right">updated {ago(age)}</div>
    </div>
  );
}
