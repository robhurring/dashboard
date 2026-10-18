import "./tokens.css";
import { Page, Pages, Slot, Title } from "../../src/layout";
import { WidgetTree } from "../../src/widgets/WidgetTree";
import { EXAMPLES, PAGES, exampleId } from "./examples";

const noop = () => Promise.resolve();
const total = PAGES.length + 1;

/**
 * Every built-in widget, several ways each, a page per group, rendered from the same examples
 * docs/widgets.md is written from; then the `echo` example module (a custom component with commands,
 * which needs the server or ?demo). Open with ?theme=gallery; swipe or use the arrow keys.
 */
export default function Gallery() {
  return (
    <Pages home="figures">
      {PAGES.map((page, i) => (
        <Page key={page.id} id={page.id} title={page.title}>
          <div className="flex h-full flex-col gap-4 overflow-y-auto pb-8 [scrollbar-width:thin]" style={{ fontSize: 16 }}>
            <Title text={page.title} sub={`${i + 1} of ${total}`} details="beside" />
            <div className="flex flex-wrap content-start gap-6">
              {EXAMPLES.filter((ex) => ex.page === page.id).map((ex) => (
                <section
                  key={exampleId(ex)}
                  id={`widget-${exampleId(ex)}`}
                  aria-label={`ui.${ex.name}${ex.variant ? `: ${ex.variant}` : ""}`}
                  className="flex flex-col rounded-xl bg-panel p-4"
                  style={{ width: ex.width ?? 360, height: ex.height ?? 240 }}
                >
                  <header className="mb-3 flex items-baseline gap-2 truncate">
                    <span className="type-title font-mono text-ink-muted">ui.{ex.name}</span>
                    {ex.variant && <span className="type-sub truncate">{ex.variant}</span>}
                  </header>
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <WidgetTree node={ex.node} send={noop} />
                  </div>
                </section>
              ))}
            </div>
          </div>
        </Page>
      ))}
      <Page id="example" title="Example module">
        <div className="flex h-full flex-col gap-4" style={{ fontSize: 16 }}>
          <Title text="Example module" sub={`${total} of ${total} · modules/echo: a component with commands and a hook`} details="beside" />
          <div id="example-echo" className="flex flex-col" style={{ width: 520, height: 320 }}>
            <Slot module="echo" chrome="full" />
          </div>
        </div>
      </Page>
    </Pages>
  );
}
