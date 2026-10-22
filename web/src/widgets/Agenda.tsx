import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
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

/** True for a few seconds whenever a pending invite appears that wasn't there before (not on first load). */
function useNewArrival(pending: Event[]): boolean {
  const seen = useRef<Set<string> | null>(null);
  const [ringing, setRinging] = useState(false);
  const keys = pending.map(keyOf).join("|");
  useEffect(() => {
    const now = new Set(keys ? keys.split("|") : []);
    const before = seen.current;
    seen.current = now;
    if (!before || ![...now].some((k) => !before.has(k))) return;
    setRinging(true);
    const t = setTimeout(() => setRinging(false), 2400);
    return () => clearTimeout(t);
  }, [keys]);
  return ringing;
}

/**
 * What's next, from a list of events: invites not yet answered under "New · respond" at the top; the
 * next event counting down large (a ring timer in its last minutes); the few after it as calendar rows.
 * Rolls on by itself as each ends, so a whole day can be handed over at once.
 */
export function Agenda({ events = [], count = 4, tz, seconds = false, empty = "Nothing coming up" }: Props) {
  const now = useNow();
  const live = events
    .map((e) => ({ e, start: instant(e.at), finish: instant(e.end) }))
    .filter((x): x is { e: Event; start: number; finish: number | null } => x.start !== null && (x.finish ?? x.start + LINGER_MS) > now)
    .sort((a, b) => a.start - b.start);
  const pending = live.filter((x) => x.e.response === "pending").map((x) => x.e);
  const ringing = useNewArrival(pending);
  const shown = live.slice(0, Math.max(1, count));
  if (shown.length === 0) return <p className="type-sub italic">{empty}</p>;
  const [next, ...rest] = shown;
  return (
    <div className="flex h-full min-h-0 flex-col gap-[1.4em]">
      {pending.length > 0 && (
        <section aria-label="New · respond" data-ringing={ringing} className={`flex flex-col gap-[0.45em] rounded-xl bg-accent/10 p-[0.7em] ${ringing ? "animate-[attention_0.6s_ease-in-out_4]" : ""}`}>
          <h3 className="type-sub flex items-center gap-[0.4em] font-semibold uppercase tracking-wide text-accent">
            <Bell className={`size-[1.1em] ${ringing ? "animate-[ring_0.6s_ease-in-out_4]" : ""}`} aria-hidden />
            New · respond
          </h3>
          <ul className="flex flex-col gap-[0.35em]">
            {pending.map((e) => (
              <li key={keyOf(e)}><Countdown style="event" at={e.at} end={e.end} label={e.title} tz={tz} /></li>
            ))}
          </ul>
        </section>
      )}
      {/* The next event, and beside it (below it when the panel is narrow) what comes after. */}
      <div className="flex min-h-0 flex-wrap items-start gap-x-[1.6em] gap-y-[1.2em]">
      <div className="min-w-[14em] flex-1">
        <Countdown at={next.e.at} end={next.e.end} label={next.e.title} icon={next.e.icon} sub={next.e.sub} tz={tz} seconds={seconds} />
      </div>
      {rest.length > 0 && (
        <section className="flex min-h-0 min-w-[18em] flex-[1.3] flex-col gap-[0.55em]">
          <h3 className="type-sub font-semibold uppercase tracking-wide">Later</h3>
          <ul className="flex min-h-0 flex-col gap-[0.45em]">
            {rest.map(({ e }) => (
              <li key={keyOf(e)}><Countdown style="event" compact at={e.at} end={e.end} label={e.title} tz={tz} badge={e.response === "pending" ? "unanswered" : undefined} /></li>
            ))}
          </ul>
        </section>
      )}
      </div>
    </div>
  );
}
