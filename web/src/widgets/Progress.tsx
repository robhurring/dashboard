import { gaugeColor } from "./Charts";

type Props = { value?: number; max?: number; label?: string; text?: string; stops?: Record<string, string>; tone?: string };

/**
 * A horizontal bar filled to `value` out of `max`. `stops` color it by how full it is, as a percent:
 * `{ [0] = "red", [10] = "yellow", [25] = "green" }` reads as "red below 10%, yellow below 25%".
 */
export function Progress({ value = 0, max = 100, label, text, stops, tone }: Props) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const color = gaugeColor(pct, { stops, tone });
  return (
    <div className="flex flex-col gap-[0.4em]">
      {(label || text) && (
        <div className="flex items-baseline justify-between gap-3">
          {label && <span className="type-label">{label}</span>}
          {text && <span className="type-sub tabular-nums">{text}</span>}
        </div>
      )}
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="h-[0.9em] w-full overflow-hidden rounded-full bg-[var(--color-track)]">
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
