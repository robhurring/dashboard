type Props = { title?: string; meta?: string; badge?: number | string; on_tap?: () => void };

export function Row({ title, meta, badge, on_tap }: Props) {
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {meta && <span className="truncate text-sm text-ink-muted">{meta}</span>}
      {badge !== undefined && <span className="rounded-full bg-accent/20 px-2 text-sm tabular-nums">{badge}</span>}
    </>
  );
  return (
    <li>
      {on_tap ? (
        <button type="button" onClick={on_tap} className="flex w-full items-center gap-3 py-2 text-left">{body}</button>
      ) : (
        <div className="flex items-center gap-3 py-2">{body}</div>
      )}
    </li>
  );
}
