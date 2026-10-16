import type { CustomProps } from "@dashboard/components/registry";
import { Icon } from "@dashboard/widgets/icons";

type Slot = { at: number; temp: number; icon: string; pop: number };
type WeatherState = {
  temp: number; feels: number; hi: number; lo: number; humidity: number; wind: number;
  sky: string; description?: string; icon: string; place: string;
  tz_offset?: number; sunrise?: number; sunset?: number; forecast?: Slot[];
};

/** A unix time as wall-clock time at the place (tz_offset seconds east of UTC), whatever zone the screen is in. */
function localTime(unix: number, tzOffset: number, withMinutes: boolean): string {
  const d = new Date((unix + tzOffset) * 1000);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const suffix = h < 12 ? "AM" : "PM";
  const hour = h % 12 || 12;
  return withMinutes ? `${hour}:${String(m).padStart(2, "0")} ${suffix}` : `${hour} ${suffix}`;
}

/** Current conditions, the next few hours, and the day's details for one place. */
export function Weather({ state, config }: CustomProps) {
  if (!state) return null;
  const s = state as WeatherState;
  const tz = s.tz_offset ?? 0;
  const windUnit = config.units === "metric" ? "km/h" : "mph";
  const details: [string, string][] = [
    ["Feels like", `${s.feels}°`],
    ["Hi / Lo", `${s.hi}° / ${s.lo}°`],
    ["Humidity", `${s.humidity}%`],
    ["Wind", `${s.wind} ${windUnit}`],
  ];
  if (s.sunrise) details.push(["Sunrise", localTime(s.sunrise, tz, true)]);
  if (s.sunset) details.push(["Sunset", localTime(s.sunset, tz, true)]);
  const forecast = s.forecast ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col gap-[0.9em]">
      <div className="flex min-h-0 flex-1 gap-[1em]">
        {/* The hero sizes itself from the space it gets (container query units), so it fills the card. */}
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center" style={{ containerType: "size" }}>
          <div className="flex items-center gap-[4cqw]">
            <Icon name={s.icon} className="shrink-0 text-accent" style={{ width: "min(50cqh, 36cqw)", height: "min(50cqh, 36cqw)" }} />
            <div className="min-w-0">
              <div className="font-semibold leading-none tracking-tight tabular-nums" style={{ fontSize: "min(46cqh, 32cqw)" }}>{s.temp}°</div>
              <div className="type-label mt-[0.3em] capitalize" style={{ fontSize: "max(0.9em, min(10cqh, 7cqw))" }}>{s.description ?? s.sky}</div>
            </div>
          </div>
        </div>
        <dl className="grid shrink-0 grid-cols-2 content-center gap-x-[1em] gap-y-[0.45em]">
          {details.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="type-sub truncate">{k}</dt>
              <dd className="type-label truncate tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {forecast.length > 0 && (
        <ul className="grid shrink-0 gap-[0.4em]" style={{ gridTemplateColumns: `repeat(${forecast.length}, minmax(0, 1fr))` }}>
          {forecast.map((f) => (
            <li key={f.at} className="flex min-w-0 flex-col items-center gap-[0.2em] rounded-lg bg-ink/5 py-[0.45em]">
              <span data-time className="type-sub">{localTime(f.at, tz, false)}</span>
              <Icon name={f.icon} className="size-[1.5em] text-accent" />
              <span className="type-label tabular-nums">{f.temp}°</span>
              <span className="type-sub h-[1.2em] tabular-nums text-paper-sky">{f.pop >= 10 ? `${f.pop}%` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
