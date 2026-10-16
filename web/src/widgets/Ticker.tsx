/** `delta` sets the color; `change` is the text shown (otherwise delta as a percent). */
type Item = { label: string; value: string; delta?: number; change?: string };

export function Ticker({ items = [] }: { items?: Item[] }) {
  return (
    <ul className="type-row flex flex-col gap-[0.5em]">
      {items.map((item, i) => {
        const d = item.delta ?? 0;
        const tone = d > 0 ? "text-good" : d < 0 ? "text-bad" : "text-ink-muted";
        return (
          <li key={`${i}-${item.label}`} className="flex items-baseline justify-between gap-3">
            <span className="font-semibold">{item.label}</span>
            <span className="tabular-nums">{item.value}</span>
            <span className={`type-sub tabular-nums ${tone}`}>{item.change ?? `${d > 0 ? "+" : ""}${d.toFixed(2)}%`}</span>
          </li>
        );
      })}
    </ul>
  );
}
