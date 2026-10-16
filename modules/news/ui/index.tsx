import ReactMarkdown from "react-markdown";
import type { CustomProps } from "@dashboard/components/registry";

/*
 * The n8n summary webhook writes digests in one shape:
 *   # <Topic> News Digest (<range>)
 *   ## <Section>
 *   - **<Lead>**: <body with [links](url)>
 * This panel renders that shape as real sections and items. Anything else falls back to markdown.
 */

export type Link = { label: string; href: string };
export type Item = { lead: string | null; body: string; links: Link[] };
export type Section = { heading: string; items: Item[] };
export type Digest = { title: string | null; range: string | null; sections: Section[] };

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Pulls `[label](url)` links out of a line, leaving the label in the text. */
function splitLinks(text: string): { text: string; links: Link[] } {
  const links: Link[] = [];
  const plain = text.replace(LINK, (_, label: string, href: string) => { links.push({ label, href }); return label; });
  return { text: plain.trim(), links };
}

function item(raw: string): Item {
  const m = /^\*\*(.+?)\*\*:?\s*(.*)$/.exec(raw.trim());
  const { text, links } = splitLinks(m ? m[2] : raw);
  return { lead: m ? m[1].trim() : null, body: text, links };
}

export function parseDigest(markdown: string): Digest {
  const digest: Digest = { title: null, range: null, sections: [] };
  let current: Section | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const h1 = /^#\s+(.+)$/.exec(t);
    if (h1 && digest.title === null) {
      const title = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(h1[1]);
      digest.title = title ? title[1] : h1[1];
      digest.range = title ? title[2] : null;
      continue;
    }
    const h = /^#{2,4}\s+(.+)$/.exec(t);
    if (h) { current = { heading: h[1], items: [] }; digest.sections.push(current); continue; }
    const bullet = /^[-*•]\s+(.+)$/.exec(t);
    if (!current) { current = { heading: "", items: [] }; digest.sections.push(current); }
    current.items.push(item(bullet ? bullet[1] : t));
  }
  return digest;
}

const isDigest = (d: Digest) => d.sections.some((s) => s.heading !== "");

function Chip({ link }: { link: Link }) {
  return (
    <a href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-full bg-accent/15 px-[0.6em] py-[0.05em] text-[0.8em] font-semibold text-accent hover:bg-accent/25">
      {link.label}
    </a>
  );
}

export function News({ state }: CustomProps) {
  if (!state) return null;
  const markdown = String((state as { markdown?: string }).markdown ?? "");
  const digest = parseDigest(markdown);
  if (!isDigest(digest)) {
    return (
      <div className="type-sub h-full min-h-0 overflow-y-auto leading-relaxed text-ink [scrollbar-width:thin]">
        <ReactMarkdown allowedElements={["p", "strong", "em", "code", "a", "ul", "ol", "li", "br"]} unwrapDisallowed skipHtml>{markdown}</ReactMarkdown>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {digest.range && <div className="type-sub mb-[0.5em] shrink-0 text-ink-muted">{digest.range}</div>}
      <div className="min-h-0 flex-1 space-y-[0.9em] overflow-y-auto pr-[0.35em] [scrollbar-width:thin]">
        {digest.sections.map((section, i) => (
          <section key={`${section.heading}-${i}`} role="group" aria-label={section.heading} className="min-w-0">
            {section.heading && <h4 className="type-sub mb-[0.35em] font-semibold tracking-wide text-accent uppercase">{section.heading}</h4>}
            <ul className="space-y-[0.5em]">
              {section.items.map((it, j) => (
                <li key={j} className="min-w-0">
                  {it.lead && <div className="type-label font-semibold leading-snug text-ink">{it.lead}</div>}
                  {it.body && (
                    <div className="type-sub leading-relaxed text-ink/80">
                      <ReactMarkdown allowedElements={["strong", "em", "code", "del"]} unwrapDisallowed skipHtml components={{ strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong> }}>{it.body}</ReactMarkdown>
                    </div>
                  )}
                  {it.links.length > 0 && <div className="mt-[0.3em] flex flex-wrap gap-[0.35em]">{it.links.map((l) => <Chip key={l.href} link={l} />)}</div>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
