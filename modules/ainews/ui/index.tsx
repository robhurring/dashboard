import type { CustomProps } from "@dashboard/components/registry";

type Item = { title: string; summary: string; url: string | null; source: string | null; published_at: string | null };

/** "3h ago", "2d ago", "just now". */
function age(iso: string | null): string | null {
  if (!iso) return null;
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(secs)) return null;
  if (secs < 60) return "just now";
  const units: [number, string][] = [[604800, "w"], [86400, "d"], [3600, "h"], [60, "m"]];
  for (const [size, suffix] of units) if (secs >= size) return `${Math.floor(secs / size)}${suffix} ago`;
  return "just now";
}

/** Headlines in the same style as the digest cards: lead, body, source chip and age. */
export function Headlines({ state }: CustomProps) {
  if (!state) return null;
  const items = ((state as { items?: Item[] }).items ?? []);
  if (items.length === 0) return <p className="type-sub italic">No news</p>;
  return (
    <ul className="h-full min-h-0 space-y-[0.6em] overflow-y-auto pr-[0.35em] [scrollbar-width:thin]">
      {items.map((it, i) => {
        const when = age(it.published_at);
        return (
          <li key={`${it.url ?? it.title}-${i}`} className="min-w-0">
            <div className="type-label font-semibold leading-snug text-ink">{it.title}</div>
            {it.summary && <div className="type-sub mt-[0.15em] line-clamp-2 leading-relaxed text-ink/80">{it.summary}</div>}
            {(it.source || when) && (
              <div className="mt-[0.3em] flex flex-wrap items-center gap-[0.5em]">
                {it.source && it.url && (
                  <a href={it.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-full bg-accent/15 px-[0.6em] py-[0.05em] text-[0.8em] font-semibold text-accent hover:bg-accent/25">{it.source}</a>
                )}
                {it.source && !it.url && <span className="text-[0.8em] font-semibold text-ink-muted">{it.source}</span>}
                {when && <span className="type-sub text-ink-muted">{when}</span>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
