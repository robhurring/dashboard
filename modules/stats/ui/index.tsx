import { useEffect, useRef, useState } from "react";
import type { CustomProps } from "@dashboard/components/registry";
import { Icon } from "@dashboard/widgets/icons";
import "./stats.css";

type Item = { source?: string; label: string; number: number; tone?: "accent" | "good" | "warn" | "bad"; icon?: string; sub?: string; ring?: boolean };
type Motion = "none" | "pop" | "ring";
/** How long a tile keeps its motion class; the longest animation (the glow) fits inside. */
const MOTION_MS = 2300;

/**
 * Which tiles moved since the last push: a number that went up pops, and if the tile is urgent
 * (tone bad, or `ring: true`) its bell rings instead. Nothing moves on the first push.
 */
/** A tile's identity: the same label from two sources is two tiles. */
const idOf = (it: Item) => `${it.source ?? ""}/${it.label}`;

function useMotion(items: Item[]): Record<string, { motion: Motion; key: number }> {
  const previous = useRef<Map<string, number> | null>(null);
  const [motions, setMotions] = useState<Record<string, { motion: Motion; key: number }>>({});
  useEffect(() => {
    const before = previous.current;
    previous.current = new Map(items.map((it) => [idOf(it), it.number]));
    if (!before) return;
    const moved: Record<string, { motion: Motion; key: number }> = {};
    for (const it of items) {
      const was = before.get(idOf(it));
      if (was === undefined || it.number <= was) continue;
      moved[idOf(it)] = { motion: it.tone === "bad" || it.ring ? "ring" : "pop", key: Date.now() };
    }
    if (Object.keys(moved).length === 0) return;
    setMotions((m) => ({ ...m, ...moved }));
    const t = setTimeout(() => setMotions((m) => {
      const next = { ...m };
      for (const id of Object.keys(moved)) if (next[id]?.key === moved[id].key) delete next[id];
      return next;
    }), MOTION_MS);
    return () => clearTimeout(t);
  }, [items]);
  return motions;
}
type State = { items: Item[]; pushed_at: number };

const EMPTY: Item[] = [];
const TONE: Record<string, string> = { accent: "text-accent", good: "text-good", warn: "text-warn", bad: "text-bad" };

/** One tile per pushed stat: icon, the number large, the label and an optional line. The panel header says when it was pushed. */
export function Stats({ state }: CustomProps) {
  const s = state as State | null;
  const motions = useMotion(s?.items ?? EMPTY);
  if (!s) return <p className="type-sub italic">Waiting for the first push</p>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {s.items.length === 0 ? (
        <p className="type-sub italic">Nothing to report</p>
      ) : (
        <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(7em,1fr))] gap-[0.75em] scroll">
          {s.items.map((it) => {
            const m = motions[idOf(it)];
            const motion: Motion = m?.motion ?? "none";
            return (
            <li key={idOf(it)} data-motion={motion} className={`min-w-0 rounded-lg bg-ink/5 px-[0.75em] py-[0.6em] ${motion === "ring" ? "stats-ring-tile" : ""}`}>
              <div className="flex items-center gap-[0.4em] text-ink-muted">
                {it.icon && (
                  <span key={motion === "ring" ? m!.key : "still"} className={`inline-flex ${motion === "ring" ? "stats-ring-icon" : ""}`}>
                    <Icon name={it.icon} className={`size-[1.1em] shrink-0 ${it.tone ? TONE[it.tone] : "text-accent"}`} />
                  </span>
                )}
                <span className="type-sub truncate">{it.label}</span>
              </div>
              <div className={`type-value mt-[0.2em] ${it.tone ? TONE[it.tone] : ""}`}>
                <span key={motion === "none" ? "still" : m!.key} className={motion === "none" ? "" : "stats-pop"}>{it.number}</span>
              </div>
              {it.sub && <div className="type-sub mt-[0.15em] truncate">{it.sub}</div>}
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
