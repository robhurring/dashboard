import ReactMarkdown, { type Components } from "react-markdown";

/*
 * Restricted markdown, styled for reading at a glance: section headings as small accent labels,
 * tidy lists, strong emphasis in ink. Links are real links that open in a new tab. Raw HTML is dropped.
 */
const ALLOWED = ["p", "br", "strong", "em", "del", "code", "a", "ul", "ol", "li", "h1", "h2", "h3", "h4", "blockquote", "hr"];
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline decoration-accent/50 underline-offset-2 hover:decoration-accent">{children}</a>
  ),
  h1: ({ children }) => <h3 className="type-label mt-[0.9em] font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="type-label mt-[0.9em] font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="type-sub mt-[0.9em] font-semibold tracking-wide text-accent uppercase first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="type-sub mt-[0.7em] font-semibold text-ink first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="type-sub mt-[0.45em] leading-relaxed text-ink first:mt-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  ul: ({ children }) => <ul className="type-sub mt-[0.35em] space-y-[0.35em] pl-[1.2em] leading-relaxed text-ink/90 marker:text-accent list-disc">{children}</ul>,
  ol: ({ children }) => <ol className="type-sub mt-[0.35em] space-y-[0.35em] pl-[1.2em] leading-relaxed text-ink/90 marker:text-accent list-decimal">{children}</ol>,
  li: ({ children }) => <li className="pl-[0.15em]">{children}</li>,
  code: ({ children }) => <code className="rounded bg-ink/10 px-[0.25em] font-mono text-[0.9em]">{children}</code>,
  blockquote: ({ children }) => <blockquote className="mt-[0.45em] border-l-2 border-accent/50 pl-[0.7em] text-ink-muted">{children}</blockquote>,
  hr: () => <hr className="my-[0.8em] border-ink/10" />,
};

export function Text({ text = "" }: { text?: string }) {
  return (
    <div className="h-full min-h-0 overflow-y-auto pr-[0.35em] [scrollbar-width:thin]">
      <ReactMarkdown allowedElements={ALLOWED} unwrapDisallowed skipHtml components={components}>{text}</ReactMarkdown>
    </div>
  );
}

const TONE: Record<string, string> = { good: "bg-good/20 text-good", bad: "bg-bad/20 text-bad", warn: "bg-warn/20 text-warn", muted: "bg-ink/10 text-ink-muted" };

export function Badge({ text, tone }: { text?: string | number; tone?: "good" | "bad" | "warn" | "muted" }) {
  return <span data-tone={tone} className={`inline-flex items-center rounded-full px-[0.6em] py-[0.1em] text-[0.85em] font-semibold tabular-nums ${tone ? TONE[tone] : "bg-accent/20 text-ink"}`}>{String(text ?? "")}</span>;
}
