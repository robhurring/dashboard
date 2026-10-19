import { useEffect, useState } from "react";
import { formatTime } from "./Clock";
import { Icon } from "./icons";

type Props = {
  /** When it starts: an ISO time ("2026-10-19T17:00:00-04:00") or unix seconds. */
  at?: string | number;
  /** When it ends, same forms; lets it say "now · 20m left", then "ended". */
  end?: string | number;
  label?: string;
  sub?: string;
  icon?: string;
  /** countdown: "in 10m" large; timer: "9:59" large; event: a calendar-like row. */
  style?: "countdown" | "timer" | "event";
  /** Include seconds in relative times (always shown under a minute). */
  seconds?: boolean;
  /** Show the clock time it starts ("5:00 pm"). Default true. */
  time?: boolean;
  /** Time zone for the clock time; default the screen's. */
  tz?: string;
  /** Minutes left when it turns yellow, then red. */
  warn_at?: number;
  bad_at?: number;
};

const MIN = 60_000;
const TONE: Record<string, string> = { warn: "text-warn", bad: "text-bad", accent: "text-accent" };

/** A span of time as its two largest units: "1d 2h", "1h 5m", "10m", "45s" (or down to seconds with `seconds`). */
function span(ms: number, { seconds, round }: { seconds: boolean; round: "up" | "down" }): string {
  const fit = round === "up" ? Math.ceil : Math.floor;
  const exact = seconds || Math.abs(ms) < MIN;
  const total = exact ? fit(ms / 1000) : fit(ms / MIN) * 60;
  const units: [string, number][] = [["d", Math.floor(total / 86400)], ["h", Math.floor(total / 3600) % 24], ["m", Math.floor(total / 60) % 60], ["s", total % 60]];
  const shown = units.filter(([, n]) => n > 0).slice(0, 2).map(([u, n]) => `${n}${u}`);
  return shown.length ? shown.join(" ") : "0s";
}

/** "in 10m", "in 1h 5m", "in 45s"; rounded up, so it never says 9m while 9:30 remain. */
export function relativeText(ms: number, { seconds }: { seconds: boolean }): string {
  return `in ${span(ms, { seconds, round: "up" })}`;
}

/** "9:05", or "1:05:00" over an hour; never below "0:00". */
export function timerText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** Plain while there's time, warn inside `warn` minutes, bad inside `bad`, accent once it has started. */
export function countdownTone(ms: number, warn: number, bad: number): "warn" | "bad" | "accent" | undefined {
  if (ms <= 0) return "accent";
  if (ms <= bad * MIN) return "bad";
  if (ms <= warn * MIN) return "warn";
  return undefined;
}

/** Milliseconds from an ISO time or unix seconds; null if it's neither. */
export function instant(t: string | number | undefined): number | null {
  if (t === undefined || t === null || t === "") return null;
  const ms = typeof t === "number" ? t * 1000 : Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

/** Ticks every second, so the countdown moves on its own. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * Time until something: a meeting, a deploy, a train. Counts down on its own; says "now" (and what's
 * left, with an `end`) once it starts. Lua views use it as ui.countdown; stats tiles with `at` too.
 */
export function Countdown({ at, end, label, sub, icon, style = "countdown", seconds = false, time = true, tz, warn_at = 10, bad_at = 2 }: Props) {
  const now = useNow();
  const start = instant(at);
  const finish = instant(end);
  if (start === null) return <p className="type-sub italic">no time</p>;
  const until = start - now;
  const status =
    until > 0 ? (style === "timer" ? timerText(until) : relativeText(until, { seconds })) :
    finish !== null && now < finish ? `now · ${span(finish - now, { seconds, round: "up" })} left` :
    finish !== null ? "ended" :
    `started ${span(-until, { seconds, round: "down" })} ago`;
  const over = finish !== null ? now >= finish : false;
  const tone = over ? undefined : countdownTone(until, warn_at, bad_at);
  const clock = (ms: number) => formatTime(new Date(ms), tz, "h:mm a");
  const when = time ? (finish !== null && style === "event" ? `${clock(start)} – ${clock(finish)}` : clock(start)) : null;

  if (style === "event") {
    return (
      <div data-style="event" data-over={over} className={`flex min-w-0 items-baseline gap-[0.8em] rounded-md bg-ink/5 px-[0.6em] py-[0.35em] ${over ? "opacity-40" : ""}`}>
        {when && <span className="type-sub shrink-0 whitespace-nowrap tabular-nums">{when}</span>}
        <span className="type-label min-w-0 flex-1 truncate">{label}</span>
        <span className={`type-sub shrink-0 font-semibold tabular-nums ${tone ? TONE[tone] : ""}`}>{status}</span>
      </div>
    );
  }
  return (
    <div data-style={style} data-over={over} className={`flex min-w-0 flex-col ${over ? "opacity-40" : ""}`}>
      {label && (
        <div className="flex items-center gap-[0.4em] text-ink-muted">
          {icon && <Icon name={icon} className={`size-[1.1em] shrink-0 ${tone ? TONE[tone] : "text-accent"}`} />}
          <span className="type-sub truncate">{label}</span>
        </div>
      )}
      <div className={`type-value mt-[0.2em] tabular-nums ${tone ? TONE[tone] : ""}`}>{status}</div>
      {(when || sub) && <div className="type-sub mt-[0.15em] truncate">{[when, sub].filter(Boolean).join(" · ")}</div>}
    </div>
  );
}
