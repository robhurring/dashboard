import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomProps } from "@dashboard/components/registry";
import { Icon } from "@dashboard/widgets/icons";
import { Inline } from "@dashboard/widgets/Inline";
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
/** The tile shape the grid aims for: a little wider than tall. */
const TILE_ASPECT = 1.25;

/**
 * Columns and rows that fill a `width` × `height` panel with `count` tiles: the layout whose tiles come
 * closest to TILE_ASPECT, with a penalty per empty cell. 6 in a tall half-screen panel is 2 × 3.
 */
export function gridFor(count: number, width: number, height: number): { cols: number; rows: number } {
  if (count <= 1) return { cols: 1, rows: 1 };
  // Not measured yet: square-ish, until the panel's size is known.
  if (width <= 0 || height <= 0) {
    const cols = Math.ceil(Math.sqrt(count));
    return { cols, rows: Math.ceil(count / cols) };
  }
  let best = { cols: 1, rows: count, score: Infinity };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const empty = cols * rows - count;
    if (empty >= cols) continue; // a whole empty row: fewer rows would do
    const score = Math.abs(Math.log(width / cols / (height / rows) / TILE_ASPECT)) + empty * 0.3;
    if (score < best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

/**
 * The element's size, kept current. A callback ref, so measuring starts whenever the element appears
 * (the grid only renders once there are stats, after the waiting message).
 */
function useSize(): [(el: HTMLElement | null) => void, { width: number; height: number }] {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => { const r = el.getBoundingClientRect(); setSize({ width: r.width, height: r.height }); };
    observer.current = new ResizeObserver(measure);
    observer.current.observe(el);
    measure();
  }, []);
  return [ref, size];
}

/**
 * One tile per pushed stat, filling the panel: the grid's columns and rows follow the count and the
 * panel's shape, and each number grows with its tile. The panel header says when it was pushed.
 */
export function Stats({ state, config }: CustomProps) {
  const s = state as State | null;
  const motions = useMotion(s?.items ?? EMPTY);
  const [ref, size] = useSize();
  if (!s) return <p className="type-sub italic">Waiting for the first push</p>;
  if (s.items.length === 0) return <p className="type-sub italic">Nothing to report</p>;
  // fill: a grid sized to the count and the panel, no dead space. flow: fixed tiles that wrap (and scroll).
  const fill = config?.layout !== "flow";
  // left: number and detail at the bottom left, under the label; center: the number in the middle.
  const align = config?.align === "center" ? "center" : "left";
  const { cols, rows } = gridFor(s.items.length, size.width, size.height);
  return (
    <ul
      ref={ref}
      data-layout={fill ? "fill" : "flow"}
      data-align={align}
      data-cols={fill ? cols : undefined}
      data-rows={fill ? rows : undefined}
      className={fill ? "grid h-full min-h-0 gap-[0.75em]" : "grid h-full min-h-0 auto-rows-min grid-cols-[repeat(auto-fill,minmax(8em,1fr))] gap-[0.75em] scroll"}
      style={fill ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` } : undefined}
    >
      {s.items.map((it, i) => {
        // In a two-column grid the last tile takes the last row's empty cell (a wide tile reads as
        // intended there); in wider grids it keeps the others' size, so the 13th looks like the 12th.
        const empty = fill && cols <= 2 ? cols * rows - s.items.length : 0;
        const span = empty > 0 && i === s.items.length - 1 ? `span ${empty + 1}` : undefined;
        const m = motions[idOf(it)];
        const motion: Motion = m?.motion ?? "none";
        return (
          <li key={idOf(it)} data-motion={motion} style={span ? { gridColumn: span } : undefined} className={`${fill ? "stats-tile" : "min-h-[6.5em]"} flex min-h-0 min-w-0 flex-col rounded-xl bg-ink/5 px-[0.9em] py-[0.75em] ${motion === "ring" ? "stats-ring-tile" : ""}`}>
            <div className="flex items-center gap-[0.45em] text-ink-muted">
              {it.icon && (
                <span key={motion === "ring" ? m!.key : "still"} className={`inline-flex ${motion === "ring" ? "stats-ring-icon" : ""}`}>
                  <Icon name={it.icon} className={`size-[1.15em] shrink-0 ${it.tone ? TONE[it.tone] : "text-accent"}`} />
                </span>
              )}
              <span className="type-label truncate"><Inline text={it.label} /></span>
            </div>
            {fill ? (
              // Centered, as large as the tile allows: stats.css sizes it from the tile and the digit count.
              <div className={`flex min-h-0 flex-1 flex-col ${align === "center" ? "items-center justify-center" : "items-start justify-end"}`}>
                <div
                  className={`stats-number font-semibold leading-none tracking-tight tabular-nums ${it.tone ? TONE[it.tone] : it.number === 0 ? "text-ink-muted" : ""}`}
                  style={{ "--digits": Math.max(1.5, String(it.number).length) } as React.CSSProperties}
                >
                  <span key={motion === "none" ? "still" : m!.key} className={motion === "none" ? "" : "stats-pop"}>{it.number}</span>
                </div>
                {it.sub && <div className="type-sub mt-[0.4em] max-w-full truncate"><Inline text={it.sub} /></div>}
              </div>
            ) : (
              <>
                <div className={`mt-auto text-[2.25em] font-semibold leading-none tracking-tight tabular-nums ${it.tone ? TONE[it.tone] : ""}`}>
                  <span key={motion === "none" ? "still" : m!.key} className={motion === "none" ? "" : "stats-pop"}>{it.number}</span>
                </div>
                {it.sub && <div className="type-sub mt-[0.3em] truncate"><Inline text={it.sub} /></div>}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
