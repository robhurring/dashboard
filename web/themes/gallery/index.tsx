import "./tokens.css";
import { Flow, Page, Pages, Slot, Tile, Title } from "../../src/layout";
import { WidgetTree } from "../../src/widgets/WidgetTree";
import { EXAMPLES, PAGES, exampleId } from "./examples";

const noop = () => Promise.resolve();
const total = PAGES.length + 2;

/** The layout page: one of each tile size, packed into a 3 × 3 grid. */
const TILES: { name: string; about: string; code: string; size?: "small" | "medium" | "large"; cols?: number; rows?: number }[] = [
  { name: "Large", about: "2 columns × 2 rows", code: '<Tile size="large">', size: "large" },
  { name: "Small", about: "1 × 1", code: '<Tile size="small">', size: "small" },
  { name: "Content-sized", about: "1 column, as many rows as its content needs", code: "<Slot ... /> (no Tile)" },
  { name: "Medium", about: "2 columns × 1 row, wide", code: '<Tile size="medium">', size: "medium" },
  { name: "Custom", about: "any columns × rows", code: "<Tile cols={1} rows={1}>", cols: 1, rows: 1 },
];

/**
 * Every built-in widget, several ways each, a page per group, rendered from the same examples
 * docs/widgets.md is written from; then the `echo` example module (a custom component with commands,
 * which needs the server or ?demo). Open with ?theme=gallery; swipe or use the arrow keys.
 */
/** A page of widget examples. */
function widgetPage(page: (typeof PAGES)[number], n: number) {
  return (
    <Page key={page.id} id={page.id} title={page.title}>
      <div className="flex h-full flex-col gap-4 scroll pb-8" style={{ fontSize: 16 }}>
        <Title text={page.title} sub={`${n} of ${total}`} details="beside" />
        <Flow>
          {EXAMPLES.filter((ex) => ex.page === page.id).map((ex) => (
            <Tile key={exampleId(ex)} size={ex.size} rows={ex.rows}>
              <section
                id={`widget-${exampleId(ex)}`}
                aria-label={`ui.${ex.name}${ex.variant ? `: ${ex.variant}` : ""}`}
                className="flex flex-col rounded-xl bg-panel p-4"
              >
                <header className="mb-3 flex items-baseline gap-2 truncate">
                  <span className="type-title font-mono text-ink-muted">ui.{ex.name}</span>
                  {ex.variant && <span className="type-sub truncate">{ex.variant}</span>}
                </header>
                <div className="min-h-0 flex-1">
                  <WidgetTree node={ex.node} send={noop} />
                </div>
              </section>
            </Tile>
          ))}
        </Flow>
      </div>
    </Page>
  );
}

/** Tile sizes: how panels arrange on a page. */
function layoutPage(n: number) {
  return (
    <Page id="layout" title="Tiles and layout">
      <div className="flex h-full flex-col gap-4 scroll pb-8" style={{ fontSize: 16 }}>
        <Title text="Tiles and layout" sub={`${n} of ${total} · <Flow>: columns on a grid of rows, like a home screen of widgets`} details="beside" />
        <div id="layout-flow">
          <Flow>
            {TILES.map((t) => (
              <Tile key={t.code} size={t.size} cols={t.cols} rows={t.rows}>
                <section className="flex flex-col justify-between rounded-xl border border-dashed border-ink/20 bg-panel p-4">
                  <div>
                    <div className="text-[1.25em] font-semibold">{t.name}</div>
                    <div className="type-sub">{t.about}</div>
                  </div>
                  <code className="type-sub font-mono text-accent">{t.code}</code>
                </section>
              </Tile>
            ))}
          </Flow>
        </div>
      </div>
    </Page>
  );
}

export default function Gallery() {
  return (
    <Pages home="figures">
      {/* Ordered for discovery: what widgets look like, then how they arrange, then the rest. */}
      {widgetPage(PAGES[0], 1)}
      {layoutPage(2)}
      {PAGES.slice(1).map((page, i) => widgetPage(page, i + 3))}
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
