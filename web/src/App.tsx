import { Suspense, lazy, useMemo } from "react";
import { OfflineBanner } from "./components/OfflineBanner";
import { currentTheme, loadTheme } from "./themes";
import { importOrReload } from "./data/chunks";

export default function App() {
  const name = currentTheme();
  const Theme = useMemo(() => lazy(() => importOrReload(() => loadTheme(name))), [name]);
  return (
    <>
      <OfflineBanner />
      <Suspense fallback={<main className="p-6 text-ink-muted">Loading theme {name}…</main>}>
        <div className="contents">
          <Theme />
        </div>
      </Suspense>
    </>
  );
}
