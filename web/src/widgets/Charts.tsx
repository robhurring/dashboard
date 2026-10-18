import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";

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
// The gauge is one SVG, so the arc and the figure scale together at any size. A 240° arc around
// (100, 100), open at the bottom; the viewBox is just tall enough for its ends.
const ARC = { cx: 100, cy: 100, r: 86, stroke: 18, from: 210, sweep: 240 };
const GAUGE_VIEW = { width: 200, height: 152 };
/** Room for the figure inside the arc, in viewBox units. */
export const GAUGE_FIGURE_WIDTH = 2 * (ARC.r - ARC.stroke / 2) - 24;

/** Font size for the figure so its digits and unit fit inside the arc; short figures cap at 60. */
export function gaugeFigureSize(figure: string, unit = ""): number {
  const ems = figure.length * 0.62 + unit.length * 0.6 * 0.45;
  return Math.min(60, Math.floor(GAUGE_FIGURE_WIDTH / ems));
}

function arcPath(fraction: number): string {
  const point = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return `${(ARC.cx + ARC.r * Math.cos(rad)).toFixed(2)} ${(ARC.cy - ARC.r * Math.sin(rad)).toFixed(2)}`;
  };
  const sweep = ARC.sweep * fraction;
  return `M ${point(ARC.from)} A ${ARC.r} ${ARC.r} 0 ${sweep > 180 ? 1 : 0} 1 ${point(ARC.from - sweep)}`;
}

export function Gauge({ value = 0, max = 100, unit, label, sub, icon, warn_at, bad_at, stops, tone, big = false }: GaugeProps) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const color = gaugeColor(value, { stops, warn_at, bad_at, tone });
  const figure = short(value);
  const size = gaugeFigureSize(figure, unit);
  return (
    <div className={`flex min-h-0 flex-col items-center ${big ? "h-full" : ""}`}>
      {/* big: the gauge takes whatever the card gives it; small: a fixed box */}
      <div role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} className={`relative w-full ${big ? "min-h-0 flex-1" : "max-w-[8em]"}`}>
        <svg className={big ? "absolute inset-0 h-full w-full" : "block h-auto w-full"} viewBox={`0 0 ${GAUGE_VIEW.width} ${GAUGE_VIEW.height}`} aria-hidden>
          <path d={arcPath(1)} fill="none" stroke={TRACK} strokeWidth={ARC.stroke} strokeLinecap="round" />
          {fraction > 0 && <path d={arcPath(fraction)} fill="none" stroke={color} strokeWidth={ARC.stroke} strokeLinecap="round" />}
          <text x={ARC.cx} y={ARC.cy + size * 0.36} textAnchor="middle" fontSize={size} fontWeight="600" fill="currentColor" className="tabular-nums">
            {figure}
            {unit && <tspan fontSize={size * 0.45} fill="var(--color-ink-muted)">{unit}</tspan>}
          </text>
        </svg>
      </div>
      {label && (
        <div className={`type-label flex items-center gap-[0.4em] ${big ? "text-[1.15em]" : ""}`}>
          {icon && <Icon name={icon} className="size-[1.2em] shrink-0 text-ink-muted" />}
          {label}
        </div>
      )}
      {sub && <div className="type-sub">{sub}</div>}
    </div>
  );
}

type LineProps = { points?: number[]; label?: string; unit?: string; min?: number; max?: number; tone?: Tone; height?: number | "fill" };

/** Chart rows for a series. A single point becomes a flat line, so a fresh series shows a line, not a dot. */
export function lineData(points: number[]): { i: number; v: number }[] {
  const data = points.map((v, i) => ({ i, v }));
  return data.length === 1 ? [data[0], { i: 1, v: data[0].v }] : data;
}

/** A sparkline-style area chart over a plain series of numbers; the latest value is shown as text. */
export function Line({ points = [], label, unit, min, max, tone = "accent", height = 3.5 }: LineProps) {
  const data = lineData(points);
  const last = points.at(-1);
  const color = TONE_VAR[tone];
  const id = `line-fill-${tone}`;
  const fill = height === "fill";
  // The chart fills the widget as its background, with the label and latest value laid over it.
  return (
    <div className={`relative flex h-full flex-col ${fill ? "min-h-0 flex-1" : ""}`} style={fill ? undefined : { minHeight: `${height}em` }}>
      <div role="img" aria-label={label} className="absolute inset-0">
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
      {(label || last !== undefined) && (
        <div className="relative flex items-baseline justify-between gap-2">
          {label && <span className="type-sub">{label}</span>}
          {last !== undefined && <span className="type-label tabular-nums">{fmt(last)}{unit && <span className="type-sub">{unit}</span>}</span>}
        </div>
      )}
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
          <li key={`${i}-${it.label}`} className="min-w-0">
            <div className="type-label tabular-nums">{fmt(it.value)}{unit}</div>
            <div className="type-sub flex items-center justify-center gap-1 truncate"><i className="size-[0.6em] rounded-full" style={{ background: palette(i) }} />{it.label}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A donut with an optional center figure and a legend. */
/** Font size, in the donut's 100-unit viewBox, that fits `center` inside the hole (68% of the radius). */
export function donutCenterSize(center: string): number {
  return Math.min(28, Math.floor(52 / (Math.max(1, center.length) * 0.62)));
}

export function Donut({ items = [], center, label }: { items?: Item[]; center?: string | number; label?: string }) {
  return (
    <div className="flex h-full min-h-0 items-center gap-[1em]">
      <div className="relative h-full min-h-[5em] w-[45%] shrink-0">
        <Sized className="absolute inset-0">
          {(w, h) => (
            <PieChart width={w} height={h} accessibilityLayer={false} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <Pie data={items} dataKey="value" nameKey="label" innerRadius="68%" outerRadius="100%" paddingAngle={2} stroke="none" isAnimationActive={false}>
                {items.map((_, i) => <Cell key={i} fill={palette(i)} />)}
              </Pie>
            </PieChart>
          )}
        </Sized>
        {/* SVG text scales with the ring, so the center always fits inside the hole. */}
        {center !== undefined && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100">
            <text x="50" y="50" dy="0.35em" textAnchor="middle" fontSize={donutCenterSize(String(center))} fontWeight="600" fill="currentColor" className="tabular-nums">{center}</text>
          </svg>
        )}
      </div>
      <ul className="flex min-w-0 flex-col gap-[0.25em]">
        {label && <li className="type-sub mb-[0.25em]">{label}</li>}
        {items.map((it, i) => (
          <li key={`${i}-${it.label}`} className="type-label flex items-center gap-2">
            <i className="size-[0.6em] shrink-0 rounded-full" style={{ background: palette(i) }} />
            <span className="truncate">{it.label}</span>
            <span className="type-sub ml-auto tabular-nums">{fmt(it.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
