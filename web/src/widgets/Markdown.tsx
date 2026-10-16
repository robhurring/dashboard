import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check } from "lucide-react";

/*
 * Full markdown for rich tiles: headings, emphasis, links, lists and task lists, tables, fenced code,
 * quotes, images and rules (GitHub-flavoured). Raw HTML is never rendered. Links open in a new tab, or
 * with `links = false` render as plain text, for screens that must never navigate away.
 */
const base: Components = {
  h1: ({ children }) => <h1 className="mt-[0.9em] text-[1.45em] leading-tight font-semibold tracking-tight first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-[0.9em] text-[1.2em] leading-tight font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-[0.8em] text-[1.05em] font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-[0.8em] text-[0.8em] font-semibold tracking-wide text-accent uppercase first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-[0.7em] font-semibold first:mt-0">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-[0.7em] text-ink-muted first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="mt-[0.55em] leading-relaxed first:mt-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  del: ({ children }) => <del className="text-ink-muted">{children}</del>,
  ul: ({ children, className }) => (
    <ul className={`mt-[0.45em] space-y-[0.3em] leading-relaxed ${className?.includes("contains-task-list") ? "pl-[0.2em]" : "list-disc pl-[1.25em] marker:text-accent"}`}>{children}</ul>
  ),
  ol: ({ children }) => <ol className="mt-[0.45em] list-decimal space-y-[0.3em] pl-[1.25em] leading-relaxed marker:text-accent">{children}</ol>,
  li: ({ children, className }) => <li className={className?.includes("task-list-item") ? "flex list-none items-baseline gap-[0.45em]" : "pl-[0.15em]"}>{children}</li>,
  // Task-list boxes, drawn in the theme's accent (a disabled native checkbox renders washed out).
  input: ({ checked }) => (
    <span
      role="checkbox"
      aria-checked={!!checked}
      aria-readonly
      className={`inline-flex size-[0.95em] shrink-0 translate-y-[0.12em] items-center justify-center rounded-[0.2em] border ${checked ? "border-accent bg-accent text-canvas" : "border-ink/35"}`}
    >
      {checked && <Check strokeWidth={3.5} className="size-[0.7em]" />}
    </span>
  ),
  code: ({ children, className }) =>
    className?.startsWith("language-") ? (
      <code className={`font-mono ${className}`}>{children}</code>
    ) : (
      <code className="rounded bg-ink/10 px-[0.3em] py-[0.05em] font-mono text-[0.88em]">{children}</code>
    ),
  pre: ({ children }) => <pre className="mt-[0.6em] overflow-x-auto rounded-lg bg-ink/[0.07] px-[0.9em] py-[0.7em] font-mono text-[0.85em] leading-relaxed [scrollbar-width:thin]">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="mt-[0.6em] border-l-2 border-accent/60 pl-[0.8em] text-ink-muted">{children}</blockquote>,
  hr: () => <hr className="my-[0.9em] border-ink/10" />,
  table: ({ children }) => (
    <div className="mt-[0.6em] overflow-x-auto [scrollbar-width:thin]">
      <table className="w-full border-collapse text-[0.9em]">{children}</table>
    </div>
  ),
  th: ({ children, style }) => <th style={style} className="border-b border-ink/15 px-[0.6em] py-[0.35em] text-left font-semibold text-ink-muted">{children}</th>,
  td: ({ children, style }) => <td style={style} className="border-b border-ink/[0.07] px-[0.6em] py-[0.35em] tabular-nums">{children}</td>,
  img: ({ src, alt }) => <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} className="mt-[0.6em] max-h-[16em] max-w-full rounded-lg" />,
};

const withLinks: Components = {
  ...base,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">{children}</a>
  ),
};

const withoutLinks: Components = { ...base, a: ({ children }) => <span className="text-accent">{children}</span> };

export function Markdown({ text = "", links = true }: { text?: string; links?: boolean }) {
  return (
    <div className="h-full min-h-0 overflow-y-auto pr-[0.35em] text-ink [scrollbar-width:thin]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={links ? withLinks : withoutLinks}>{text}</ReactMarkdown>
    </div>
  );
}
