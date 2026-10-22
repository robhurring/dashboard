import type { ReactNode } from "react";

/*
 * Light markdown for one-line labels and details: **bold**, *italic* or _italic_, __underline__,
 * ~~strike~~ and `code`. Anything else (and any marker without its pair) shows as typed; it never
 * becomes HTML. `__` is underline here, not bold: bold already has `**`.
 */
const TOKEN = /(`[^`]+`)|(\*\*[^*]+?\*\*)|(__[^_]+?__)|(~~[^~]+?~~)|(\*[^*\s][^*]*?\*)|((?<![A-Za-z0-9])_[^_\s][^_]*?_(?![A-Za-z0-9]))/g;

export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const [whole, code, bold, under, strike, star, underscore] = m;
    const key = out.length;
    if (code) out.push(<code key={key} className="rounded bg-ink/10 px-[0.25em] font-mono text-[0.9em]">{code.slice(1, -1)}</code>);
    else if (bold) out.push(<strong key={key} className="font-semibold">{bold.slice(2, -2)}</strong>);
    else if (under) out.push(<u key={key} className="underline-offset-2">{under.slice(2, -2)}</u>);
    else if (strike) out.push(<del key={key}>{strike.slice(2, -2)}</del>);
    else out.push(<em key={key}>{(star ?? underscore).slice(1, -1)}</em>);
    last = i + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A label or detail line with light markdown. */
export function Inline({ text }: { text?: string | number | null }) {
  if (text === undefined || text === null) return null;
  return <>{inline(String(text))}</>;
}
