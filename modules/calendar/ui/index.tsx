import type { CustomProps } from "@dashboard/components/registry";

type Event = { title: string; start: string; end: string; all_day: boolean; calendar: string };
type State = { from: string; days: number; events: Event[] };

const DAY_MS = 86_400_000;

/** Local midnight of a YYYY-MM-DD. */
function localDay(ymd: string): Date {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/* Starts are strings in the host zone ("2026-10-15T17:00:00-04:00" or "2026-10-15"). Read the
   date and wall-clock time straight off them, so the kiosk shows the same times whatever zone
   the browser happens to run in. */
function dayOf(e: Event): Date {
  return localDay(e.start);
}

function timeOf(iso: string): string {
  const h = Number(iso.slice(11, 13));
  const m = iso.slice(14, 16);
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 || 12}:${m} ${suffix}`;
}

function dayName(i: number, date: Date): string {
  if (i === 0) return "Today";
  if (i === 1) return "Tomorrow";
  return date.toLocaleDateString([], { weekday: "long" });
}

/**
 * Upcoming days as columns; each day's events in time order, all-day ones first. "Today" is the
 * current date on the clock, not the day the state was fetched, so a cached state never shows
 * yesterday as today.
 */
/** An event is past once its end has passed. The end string carries the host zone's offset, so this is exact in any browser. */
function isPast(e: Event, now: Date): boolean {
  if (e.all_day) return localDay(e.end).getTime() <= new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return new Date(e.end).getTime() < now.getTime();
}

export function Calendar({ state, config }: CustomProps) {
  if (!state) return null;
  const s = state as State;
  const hidePast = config.past === "hide";
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Array.from({ length: Math.max(1, s.days) }, (_, i) => {
    const date = new Date(first.getTime() + i * DAY_MS);
    const events = s.events
      .filter((e) => dayOf(e).getTime() === date.getTime())
      .filter((e) => !(hidePast && isPast(e, now)))
      .sort((a, b) => (a.all_day === b.all_day ? a.start.localeCompare(b.start) : a.all_day ? -1 : 1));
    return { date, label: dayName(i, date), events };
  });
  return (
    <div className="h-full min-h-0 overflow-y-auto pr-[0.35em] [scrollbar-width:thin]">
      {days.map((day, i) => (
        <section key={day.date.toISOString()} role="group" aria-label={day.label} className="min-w-0">
          <header className={`sticky top-0 z-10 flex items-baseline gap-[0.6em] bg-panel py-[0.35em] ${i === 0 ? "" : "mt-[0.6em]"}`}>
            <span className={`type-label font-semibold ${i === 0 ? "text-accent" : ""}`}>{day.label}</span>
            <span className="type-sub">{day.date.toLocaleDateString([], { weekday: i < 2 ? "short" : undefined, month: "short", day: "numeric" })}</span>
            <span className="ml-[0.2em] h-px flex-1 bg-ink/10" />
          </header>
          {day.events.length === 0 ? (
            <p className="type-sub py-[0.3em] pl-[0.2em] italic">Nothing planned</p>
          ) : (
            <ul className="flex flex-col gap-[0.35em]">
              {day.events.map((e, j) => (
                <li key={`${e.start}-${j}`} data-past={isPast(e, now)} className={`flex min-w-0 items-baseline gap-[0.8em] rounded-md bg-ink/5 px-[0.6em] py-[0.35em] ${isPast(e, now) ? "opacity-40" : ""}`}>
                  <span className="type-sub w-[10em] shrink-0 whitespace-nowrap tabular-nums">{e.all_day ? "all day" : `${timeOf(e.start)} – ${timeOf(e.end)}`}</span>
                  <span className="type-label min-w-0 flex-1 leading-snug">{e.title}</span>
                  <span className="type-sub shrink-0 opacity-70">{e.calendar}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
