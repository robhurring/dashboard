import { Countdown, instant, useNow } from "./Countdown";

type Event = { title: string; at: string | number; end?: string | number; icon?: string; sub?: string };
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
export function Agenda({ events = [], count = 4, tz, seconds = false, empty = "Nothing coming up" }: Props) {
  const now = useNow();
  const live = events
    .map((e) => ({ e, start: instant(e.at), finish: instant(e.end) }))
    .filter((x): x is { e: Event; start: number; finish: number | null } => x.start !== null && (x.finish ?? x.start + LINGER_MS) > now)
    .sort((a, b) => a.start - b.start)
    .slice(0, Math.max(1, count));
  if (live.length === 0) return <p className="type-sub italic">{empty}</p>;
  const [next, ...rest] = live;
  return (
    <div className="flex h-full min-h-0 flex-col gap-[1.4em]">
      <Countdown at={next.e.at} end={next.e.end} label={next.e.title} icon={next.e.icon} sub={next.e.sub} tz={tz} seconds={seconds} />
      {rest.length > 0 && (
        <section className="flex min-h-0 flex-col gap-[0.55em]">
          <h3 className="type-sub font-semibold uppercase tracking-wide">Later</h3>
          <ul className="flex min-h-0 flex-col gap-[0.45em]">
            {rest.map(({ e }, i) => (
              <li key={`${e.title}-${i}`}><Countdown style="event" at={e.at} end={e.end} label={e.title} tz={tz} /></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
