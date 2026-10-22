import { useEffect, useRef, useState } from "react";
import { Countdown, instant, useNow } from "./Countdown";

type Event = { title: string; at: string | number; end?: string | number; icon?: string; sub?: string; response?: string };
type Props = {
  events?: Event[];
  /** How many to show: the next one large, the rest as rows. */
  count?: number;
  /** Time zone for clock times; default the screen's. */
  tz?: string;
  /** Include seconds in the countdown. */
  seconds?: boolean;
  /** Shown when nothing is coming up. */
  empty?: string;
};

/** How long an event with no end stays after it starts (the upcoming module keeps it as long). */
const LINGER_MS = 10 * 60_000;

/**
 * What's next, from a list of events: the next one (or the one on now) counting down large, the few
 * after it as calendar rows. Rolls on by itself as each ends, so a whole day can be handed over at once.
 */
const keyOf = (e: Event) => `${e.title}@${e.at}`;

/** Keys of pending invites that just arrived (not on first load), for a few seconds. */
function useNewArrivals(pending: Event[]): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const keys = pending.map(keyOf).join("|");
  useEffect(() => {
    const now = new Set(keys ? keys.split("|") : []);
    const before = seen.current;
    seen.current = now;
    if (!before) return;
    const arrived = new Set([...now].filter((k) => !before.has(k)));
    if (arrived.size === 0) return;
    setFresh(arrived);
    const t = setTimeout(() => setFresh(new Set()), 2400);
    return () => clearTimeout(t);
  }, [keys]);
  return fresh;
}

/**
 * What's next, from a list of events: the next one counting down large (a timer over a draining bar in
 * its last minutes), the few after it as calendar rows beside it. Invites not answered yet stay in their
 * place, with a bell and a tint, and glow when they arrive. Rolls on by itself as each ends, so a whole
 * day can be handed over at once.
 */
export function Agenda({ events = [], count = 4, tz, seconds = false, empty = "Nothing coming up" }: Props) {
  const now = useNow();
  const live = events
    .map((e) => ({ e, start: instant(e.at), finish: instant(e.end) }))
    .filter((x): x is { e: Event; start: number; finish: number | null } => x.start !== null && (x.finish ?? x.start + LINGER_MS) > now)
    .sort((a, b) => a.start - b.start);
  const fresh = useNewArrivals(live.filter((x) => x.e.response === "pending").map((x) => x.e));
  const shown = live.slice(0, Math.max(1, count));
  if (shown.length === 0) return <p className="type-sub italic">{empty}</p>;
  const [next, ...rest] = shown;
  return (
    <div data-agenda data-layout="rows" className="flex h-full min-h-0 flex-col gap-[1.1em]">
      {/* The next event, one full-width row; what comes after stacks under it. */}
      <Countdown inline at={next.e.at} end={next.e.end} label={next.e.title} icon={next.e.response === "pending" ? "bell-dot" : next.e.icon} sub={next.e.response === "pending" ? ["not answered", next.e.sub].filter(Boolean).join(" · ") : next.e.sub} tz={tz} seconds={seconds} />
      {rest.length > 0 && (
        <section className="flex min-h-0 flex-col gap-[0.5em]">
          <h3 className="type-sub font-semibold uppercase tracking-wide">Later</h3>
          <ul className="flex min-h-0 flex-col gap-[0.4em]">
            {rest.map(({ e }) => {
              const isNew = fresh.has(keyOf(e));
              return (
                <li key={keyOf(e)} data-new={isNew} className={isNew ? "rounded-lg animate-[attention_0.6s_ease-in-out_4]" : ""}>
                  <Countdown style="event" at={e.at} end={e.end} label={e.title} tz={tz} pending={e.response === "pending"} />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
