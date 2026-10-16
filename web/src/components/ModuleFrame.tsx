import { LoaderCircle } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { interpolate } from "../data/template";
import { useModule } from "../data/useModule";
import { WidgetTree } from "../widgets/WidgetTree";
import { Icon } from "../widgets/icons";
import { ErrorBoundary } from "./ErrorBoundary";
import { customComponent } from "./registry";

export type Density = "compact" | "normal" | "large";
export type Chrome = "full" | "minimal" | "none";

const DENSITY_CLASS: Record<Density, string> = { compact: "text-sm", normal: "", large: "text-lg" };
/** Fetches usually finish in well under this, so the refetch spinner never blinks for them. */
const SPINNER_DELAY_MS = 300;

function useDelayed(on: boolean, ms: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on) { setShown(false); return; }
    const t = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return on && shown;
}

/**
 * `component` picks another export of the module's ui/index.tsx instead of the module's default.
 * Widget views get the full card chrome by default; a custom component owns its whole slot
 * (no panel, no header) unless the slot asks for `chrome`.
 */
export function ModuleFrame({ id, title, icon: iconProp, density = "normal", chrome: chromeProp, component }: { id: string; title?: string; icon?: string; density?: Density; chrome?: Chrome; component?: string }) {
  const { info, slice, send } = useModule(id);
  const custom = !!info && (info.kind === "state" || !!component);
  const chrome: Chrome = chromeProp ?? (custom ? "none" : "full");
  const status = slice?.status ?? null;
  const stale = status !== null && !status.ok && (slice?.rev ?? 0) > 0;
  // Push-only modules have nothing to load: before the first push they render their own waiting state.
  const firstLoad = !!info && !info.push_only && !status?.load_error && (!slice || slice.rev === 0);
  const refetching = useDelayed(!firstLoad && !!status?.loading, SPINNER_DELAY_MS);
  const spinner = <LoaderCircle data-testid="loading-spinner" aria-label="loading" className="size-4 shrink-0 animate-spin text-ink-muted" />;
  const phase = !info ? "unknown" : status?.load_error ? "error" : firstLoad ? "loading" : "content";
  const heading = interpolate(title ?? info?.title ?? id, { config: slice?.config ?? {}, state: slice?.state ?? {}, status: status ?? {} });

  let body;
  if (!info) body = <p className="text-sm text-ink-muted">Unknown instance {id}</p>;
  else if (status?.load_error) body = <p role="alert" className="type-sub text-bad">{status.load_error}</p>;
  else if (firstLoad || !slice) body = <p className="type-sub flex items-center gap-2">{spinner}Loading…</p>;
  else if (slice.view) body = <WidgetTree node={slice.view} send={send} />;
  else if (slice.kind === "state" && (component || info.component)) {
    const name = component ?? info.component!;
    const Custom = customComponent(info.module, name);
    body = Custom ? (
      <ErrorBoundary label={name}>
        <Suspense fallback={<p className="type-sub flex items-center gap-2">{spinner}Loading…</p>}>
          <Custom state={slice.state} config={slice.config as Record<string, never>} status={status} send={send} title={heading} density={density} />
        </Suspense>
      </ErrorBoundary>
    ) : (
      <p role="alert" className="type-sub text-bad">No component {name} in modules/{info.module}/ui</p>
    );
  } else body = <p className="type-sub">No renderer for {id}</p>;
  // Remounting on a phase change replays the fade, so content eases in instead of popping over the loader.
  const faded = <div key={phase} data-testid="frame-body" className="h-full min-h-0 animate-fade-in">{body}</div>;

  const dot = stale && <span data-testid="stale-dot" title={status?.error ?? "stale"} className="size-2 shrink-0 rounded-full bg-warn" />;
  if (chrome === "none") {
    return (
      <section aria-label={heading} data-density={density} className={`relative flex min-h-0 flex-1 flex-col ${DENSITY_CLASS[density]}`}>
        {refetching && <span className="absolute top-0 right-0 animate-fade-in">{spinner}</span>}
        {faded}
      </section>
    );
  }
  return (
    <section className={`flex min-h-0 flex-1 flex-col rounded-xl bg-panel p-4 ${DENSITY_CLASS[density]}`} aria-label={heading} data-density={density}>
      <header className="type-title mb-3 flex min-h-4 items-center gap-2">
        {chrome === "full" && (iconProp ?? info?.icon) && <Icon name={(iconProp ?? info?.icon)!} className="size-[1.15em] shrink-0 text-accent" />}
        {chrome === "full" && <span className="truncate">{heading}</span>}
        {dot}
        {refetching && <span className="ml-auto animate-fade-in">{spinner}</span>}
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{faded}</div>
    </section>
  );
}
