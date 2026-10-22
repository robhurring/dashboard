import { useEffect, useState } from "react";
import { formatTime } from "./Clock";
import { Icon } from "./icons";
import { Inline } from "./Inline";

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
  /** Minutes before the start when a countdown becomes a ring timer ("4:59" inside a draining ring); 0: never. */
  ring_at?: number;
  /** An event row's marker, e.g. "unanswered": a small accent dot (the word is for screen readers). */
  badge?: string;
  /** An event row that shows only the start time, for narrow columns. */
  compact?: boolean;
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
export function Countdown({ at, end, label, sub, icon, style = "countdown", seconds = false, time = true, tz, warn_at = 10, bad_at = 2, ring_at = 5, badge, compact = false }: Props) {
  const now = useNow();
  const start = instant(at);
  const finish = instant(end);
  if (start === null) return <p className="type-sub italic">no time</p>;
  const until = start - now;
  const on = until <= 0 && finish !== null && now < finish;
  const left = on ? `${span(finish! - now, { seconds, round: "up" })} left` : null;
  const status =
    until > 0 ? (style === "timer" ? timerText(until) : relativeText(until, { seconds })) :
    finish !== null && now < finish ? `now · ${span(finish - now, { seconds, round: "up" })} left` :
    finish !== null ? "ended" :
    `started ${span(-until, { seconds, round: "down" })} ago`;
  const over = finish !== null ? now >= finish : false;
  const tone = over ? undefined : countdownTone(until, warn_at, bad_at);
  const clock = (ms: number) => formatTime(new Date(ms), tz, "h:mm a");
  const when = time ? (finish !== null && style === "event" && !compact ? `${clock(start)} – ${clock(finish)}` : clock(start)) : null;

  if (style === "event") {
    return (
      <div data-style="event" data-over={over} className={`flex min-w-0 items-baseline gap-[0.9em] rounded-lg bg-ink/5 px-[0.8em] py-[0.55em] ${over ? "opacity-40" : ""}`}>
        {when && <span className={`type-sub shrink-0 whitespace-nowrap tabular-nums ${compact ? "w-[4.6em]" : "w-[9.5em]"}`}>{when}</span>}
        <span className="type-label flex min-w-0 flex-1 items-center gap-[0.45em]">
          {badge && <span title={badge} className="size-[0.5em] shrink-0 self-center rounded-full bg-accent"><span className="sr-only">{badge}</span></span>}
          <span className="truncate"><Inline text={label} /></span>
        </span>
        <span className={`type-sub shrink-0 font-semibold tabular-nums ${tone ? TONE[tone] : ""}`}>{status}</span>
      </div>
    );
  }
  // The last few minutes: a timer inside a ring that drains to "now", like the iOS timer.
  const ringing = style === "countdown" && ring_at > 0 && until > 0 && until <= ring_at * MIN;
  if (ringing) {
    const left = until / (ring_at * MIN);
    const R = 44, C = 2 * Math.PI * R;
    return (
      <div data-style="countdown" className="flex min-w-0 items-center gap-[1.2em]">
        <div data-ring data-left={left.toFixed(3)} className="relative size-[7.5em] shrink-0">
          <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="50" cy="50" r={R} fill="none" strokeWidth="7" className="stroke-ink/10" />
            <circle cx="50" cy="50" r={R} fill="none" strokeWidth="7" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - left)} className={`transition-[stroke-dashoffset] duration-1000 ease-linear ${tone === "bad" ? "stroke-bad" : tone === "warn" ? "stroke-warn" : "stroke-accent"}`} />
          </svg>
          <span className={`absolute inset-0 flex items-center justify-center text-[1.9em] font-semibold tabular-nums ${tone ? TONE[tone] : ""}`}>{timerText(until)}</span>
        </div>
        <div className="flex min-w-0 flex-col">
          {label && (
            <div className="flex items-center gap-[0.45em] text-ink-muted">
              {icon && <Icon name={icon} className={`size-[1.15em] shrink-0 ${tone ? TONE[tone] : "text-accent"}`} />}
              <span className="type-label truncate"><Inline text={label} /></span>
            </div>
          )}
          {(when || sub) && <div className="type-sub mt-[0.4em] truncate"><Inline text={[when, sub].filter(Boolean).join(" · ")} /></div>}
        </div>
      </div>
    );
  }
  return (
    <div data-style={style} data-over={over} className={`flex min-w-0 flex-col ${over ? "opacity-40" : ""}`}>
      {label && (
        <div className="flex items-center gap-[0.45em] text-ink-muted">
          {icon && <Icon name={icon} className={`size-[1.15em] shrink-0 ${tone ? TONE[tone] : "text-accent"}`} />}
          <span className="type-label truncate"><Inline text={label} /></span>
        </div>
      )}
      {/* While it's on: large "now", with what's left on the line below. */}
      <div className={`type-value mt-[0.4em] tabular-nums ${tone ? TONE[tone] : ""}`}>{on ? "now" : status}</div>
      {(left || when || sub) && <div className="type-sub mt-[0.5em] truncate"><Inline text={[left, when, sub].filter(Boolean).join(" · ")} /></div>}
    </div>
  );
}
