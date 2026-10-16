import "./tokens.css";
import { Slot } from "../../src/layout";
import { WidgetTree } from "../../src/widgets/WidgetTree";
import { EXAMPLES } from "./examples";

const noop = () => Promise.resolve();

/**
 * Every built-in widget, rendered from the same examples docs/widgets.md is written from, plus the
 * `echo` example module (a custom component with commands). Open with ?theme=gallery. The widgets
 * are static; the echo panel needs the server, or ?demo.
 */
export default function Gallery() {
  return (
    <main className="h-full overflow-y-auto p-6" style={{ fontSize: 16 }}>
      <div className="flex flex-wrap items-start gap-6">
        {EXAMPLES.map((ex) => (
          <section
            key={ex.name}
            id={`widget-${ex.name}`}
            aria-label={`ui.${ex.name}`}
            className="flex flex-col rounded-xl bg-panel p-4"
            style={{ width: ex.width ?? 360, height: ex.height ?? 240 }}
          >
            <header className="type-title mb-3 font-mono text-ink-muted">ui.{ex.name}</header>
            <div className="min-h-0 flex-1 overflow-hidden">
              <WidgetTree node={ex.node} send={noop} />
            </div>
          </section>
        ))}
        <div id="example-echo" className="flex flex-col" style={{ width: 520, height: 320 }}>
          <Slot module="echo" chrome="full" />
        </div>
      </div>
    </main>
  );
}
