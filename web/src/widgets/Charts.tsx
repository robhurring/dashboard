import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, PolarAngleAxis, RadialBar, RadialBarChart, XAxis, YAxis } from "recharts";

/*
 * Chart widgets, drawn by Recharts and colored only through theme tokens so every theme restyles
 * them. Text (values, labels, legends) is plain HTML next to the SVG: readable at a distance,
 * testable, and unaffected by chart size.
 */

/**
 * Renders a chart only once its box has a size, with that exact size. Charts are display only
 * (no pointer events, nothing focusable) and never render at 0x0.
 */
function Sized({ className, children }: { className?: string; children: (width: number, height: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      setSize(width > 0 && height > 0 ? { width: Math.round(width), height: Math.round(height) } : null);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={`pointer-events-none select-none ${className ?? ""}`} aria-hidden>
      {size && children(size.width, size.height)}
    </div>
  );
}

export type Tone = "accent" | "good" | "warn" | "bad";
const TONE_VAR: Record<Tone, string> = { accent: "var(--color-accent)", good: "var(--color-good)", warn: "var(--color-warn)", bad: "var(--color-bad)" };
/** Friendly names for the theme tones; anything else is taken as a CSS color. */
const COLOR_ALIAS: Record<string, Tone> = { accent: "accent", purple: "accent", blue: "accent", good: "good", green: "good", warn: "warn", yellow: "warn", amber: "warn", orange: "warn", bad: "bad", red: "bad" };
export function colorOf(name: string): string {
  const tone = COLOR_ALIAS[name.toLowerCase()];
  return tone ? TONE_VAR[tone] : name;
}
const TRACK = "var(--color-track)";
const SERIES = ["accent", "paper-sky", "paper-tangerine", "paper-coral", "paper-canary", "good"];

/** The n-th series color, cycling through the theme's chart tokens. */
export function palette(i: number): string {
  return `var(--color-${SERIES[i % SERIES.length]})`;
}

type Stops = Record<string, string>;

/**
 * The gauge's color below every stop is `tone`: green when stops are set (the green, yellow, red
 * scheme), the accent when there are none. At a stop the color becomes that stop's; the highest
 * stop at or below the value wins. `warn_at` / `bad_at` are shorthand stops.
 */
export function gaugeColor(value: number, { stops, warn_at, bad_at, tone }: { stops?: Stops; warn_at?: number; bad_at?: number; tone?: string }): string {
  const all: [number, string][] = Object.entries(stops ?? {}).map(([at, c]) => [Number(at), c]);
  if (warn_at !== undefined) all.push([warn_at, "warn"]);
  if (bad_at !== undefined) all.push([bad_at, "bad"]);
  const hit = all.filter(([at]) => Number.isFinite(at) && value >= at).sort((a, b) => b[0] - a[0])[0];
  return colorOf(hit ? hit[1] : (tone ?? (all.length > 0 ? "good" : "accent")));
}

/** Gauges are read from across a room: whole numbers from 10 up, one decimal below. */
const short = (n: number) => (Math.abs(n) >= 10 ? String(Math.round(n)) : fmt(Math.round(n * 10) / 10));
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) < 10 ? 2 : 1).replace(/\.?0+$/, ""));

type GaugeProps = { value?: number; max?: number; unit?: string; label?: string; sub?: string; icon?: string; warn_at?: number; bad_at?: number; stops?: Stops; tone?: string; big?: boolean };

/** A half-circle gauge with the value in the middle. */
export function Gauge({ value = 0, max = 100, unit, label, sub, icon, warn_at, bad_at, stops, tone, big = false }: GaugeProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const color = gaugeColor(value, { stops, warn_at, bad_at, tone });
  return (
    <div className={`flex min-h-0 flex-col items-center ${big ? "h-full" : ""}`}>
      {/* big: the arc takes whatever the card gives it; small: a fixed 2:1 box */}
      <div role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} className={`relative w-full ${big ? "min-h-0 flex-1" : "aspect-[2/1] max-w-[10em]"}`}>
        <Sized className="absolute inset-0">
          {(w, h) => (
            <RadialBarChart width={w} height={h} accessibilityLayer={false} data={[{ v: pct }]} startAngle={210} endAngle={-30} innerRadius="72%" outerRadius="100%" cy="60%" barSize={12}>
              {/* Without a fixed domain the axis scales to the data and every gauge reads as full. */}
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar dataKey="v" background={{ fill: TRACK }} fill={color} cornerRadius={8} isAnimationActive={false} />
            </RadialBarChart>
          )}
        </Sized>
        {/* SVG text scales with the gauge, so the figure always fits inside the arc. */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 200 100" aria-hidden>
          <text x="100" y="74" textAnchor="middle" fontSize="34" fontWeight="600" fill="currentColor" className="tabular-nums">
            {short(value)}
            {unit && <tspan fontSize="16" fill="var(--color-ink-muted)">{unit}</tspan>}
          </text>
        </svg>
      </div>
      {label && (
        <div className={`type-label -mt-[0.5em] flex items-center gap-[0.4em] ${big ? "text-[1.15em]" : ""}`}>
          {icon && <Icon name={icon} className="size-[1.2em] shrink-0 text-ink-muted" />}
          {label}
        </div>
      )}
      {sub && <div className="type-sub">{sub}</div>}
    </div>
  );
}

type LineProps = { points?: number[]; label?: string; unit?: string; min?: number; max?: number; tone?: Tone; height?: number | "fill" };

/** A sparkline-style area chart over a plain series of numbers; the latest value is shown as text. */
export function Line({ points = [], label, unit, min, max, tone = "accent", height = 3.5 }: LineProps) {
  const data = points.map((v, i) => ({ i, v }));
  const last = points.at(-1);
  const color = TONE_VAR[tone];
  const id = `line-fill-${tone}`;
  const fill = height === "fill";
  return (
    <div className={`flex min-h-0 flex-col ${fill ? "h-full flex-1" : ""}`}>
      {(label || last !== undefined) && (
        <div className="flex items-baseline justify-between gap-2">
          {label && <span className="type-sub">{label}</span>}
          {last !== undefined && <span className="type-label tabular-nums">{fmt(last)}{unit && <span className="type-sub">{unit}</span>}</span>}
        </div>
      )}
      <div role="img" aria-label={label} className={`w-full ${fill ? "min-h-0 flex-1" : ""}`} style={fill ? undefined : { height: `${height}em` }}>
      <Sized className="h-full w-full">
        {(w, h) => (
          <AreaChart width={w} height={h} accessibilityLayer={false} data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={[min ?? "auto", max ?? "auto"]} />
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false} dot={false} />
          </AreaChart>
        )}
      </Sized>
      </div>
    </div>
  );
}

type Item = { label: string; value: number };

/** Vertical bars with the item labels underneath and values above. */
export function BarWidget({ items = [], label, unit }: { items?: Item[]; label?: string; unit?: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {label && <div className="type-sub">{label}</div>}
      <div role="img" aria-label={label} className="min-h-[4em] w-full flex-1">
      <Sized className="h-full w-full">
        {(w, h) => (
          <BarChart width={w} height={h} accessibilityLayer={false} data={items} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap="25%">
            <XAxis dataKey="label" hide />
            <Bar dataKey="value" radius={[6, 6, 2, 2]} isAnimationActive={false}>
              {items.map((_, i) => <Cell key={i} fill={palette(i)} />)}
            </Bar>
          </BarChart>
        )}
      </Sized>
      </div>
      <ul className="mt-[0.5em] flex justify-around gap-2 text-center">
        {items.map((it, i) => (
          <li key={it.label} className="min-w-0">
            <div className="type-label tabular-nums">{fmt(it.value)}{unit}</div>
            <div className="type-sub flex items-center justify-center gap-1 truncate"><i className="size-[0.6em] rounded-full" style={{ background: palette(i) }} />{it.label}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A donut with an optional center figure and a legend. */
export function Donut({ items = [], center, label }: { items?: Item[]; center?: string | number; label?: string }) {
  return (
    <div className="flex h-full min-h-0 items-center gap-[1em]">
      <div className="relative h-full min-h-[5em] w-[45%] shrink-0">
        <Sized className="absolute inset-0">
          {(w, h) => (
            <PieChart width={w} height={h} accessibilityLayer={false}>
              <Pie data={items} dataKey="value" nameKey="label" innerRadius="68%" outerRadius="100%" paddingAngle={2} stroke="none" isAnimationActive={false}>
                {items.map((_, i) => <Cell key={i} fill={palette(i)} />)}
              </Pie>
            </PieChart>
          )}
        </Sized>
        {center !== undefined && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="type-value">{center}</span></div>}
      </div>
      <ul className="flex min-w-0 flex-col gap-[0.25em]">
        {label && <li className="type-sub mb-[0.25em]">{label}</li>}
        {items.map((it, i) => (
          <li key={it.label} className="type-label flex items-center gap-2">
            <i className="size-[0.6em] shrink-0 rounded-full" style={{ background: palette(i) }} />
            <span className="truncate">{it.label}</span>
            <span className="type-sub ml-auto tabular-nums">{fmt(it.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
