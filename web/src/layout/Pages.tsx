import { Children, createContext, isValidElement, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";

type PageProps = { id: string; title: string; children?: ReactNode };
const ActivePage = createContext<string>("");
/** Whether the enclosing page is on screen. Outside any Page, everything counts as visible. */
export const PageVisible = createContext<boolean>(true);

/** One page: a full-size slide in the track. Every page stays mounted so its slots stay declared; inactive ones are inert. */
export function Page({ id, children }: PageProps) {
  const active = useContext(ActivePage);
  const off = active !== id;
  return (
    <div className="flex h-full w-full min-w-0 shrink-0 flex-col" data-page={id} aria-hidden={off} inert={off}>
      <PageVisible.Provider value={!off}>{children}</PageVisible.Provider>
    </div>
  );
}

function parseDuration(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^(\d+)(s|m|h)$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "s" ? n * 1000 : m[2] === "m" ? n * 60_000 : n * 3_600_000;
}

/*
 * The view is always locked on a whole page. A gesture never drags the track; once it shows a clear
 * horizontal direction it triggers one full page transition, and the rest of that gesture is spent.
 */
/** Movement before a drag is judged horizontal (ours) or vertical (the page's own scrolling). */
const AXIS_LOCK_PX = 8;
/** Horizontal travel that makes a drag or a trackpad swipe commit to the next page. */
const DRAG_COMMIT_PX = 60;
const WHEEL_COMMIT_PX = 60;
/** Inside a spent gesture, a same-direction delta this big and this many times the previous one is a new push, not the tail. */
const NEW_PUSH_MIN_PX = 40;
const NEW_PUSH_RATIO = 4;
/** A trackpad gesture (fingers plus macOS momentum tail) is over after this much silence. */
const WHEEL_GESTURE_GAP_MS = 300;
/** The settle: an expo ease-out, long enough to read as a page gliding into place. */
const SLIDE_MS = 560;
const SLIDE_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
/** The dots fade in while a swipe is in progress and stay this long after a page change. */
const DOTS_LINGER_MS = 1200;
const PAGE_KEY = "dashboard.page";

type Drag = { id: number; x: number; y: number; axis: "x" | "y" | null; spent: boolean };

/**
 * Pages side by side in a track. Swipe (touch or mouse), two-finger trackpad swipe, arrow keys or
 * the dots at the bottom move between them, one page at a time. Regions opt out of swiping with
 * `data-swipe="off"`, or allow only touch with `data-swipe="touch"` (draggable things do this).
 */
export function Pages({ home, returnHomeAfter, children }: { home: string; returnHomeAfter?: string; children: ReactNode }) {
  const pages = Children.toArray(children).filter(
    (c): c is ReactElement<PageProps> => isValidElement(c) && typeof (c.props as PageProps).id === "string",
  );
  const ids = pages.map((p) => p.props.id);
  // The page you were on survives a reload (a per-viewer convenience, so browser storage is right for it).
  const [active, setActive] = useState(() => {
    try {
      const saved = localStorage.getItem(PAGE_KEY);
      return saved && ids.includes(saved) ? saved : home;
    } catch {
      return home;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(PAGE_KEY, active); } catch { /* storage unavailable: nothing to remember */ }
  }, [active]);
  const index = Math.max(0, ids.indexOf(active));
  const [gesturing, setGesturing] = useState(false);
  const [recentlyChanged, setRecentlyChanged] = useState(false);
  const drag = useRef<Drag | null>(null);
  // dx: travel in this gesture; dir: direction it moved a page in (0 = not yet); reverse: travel the
  // other way since then. Momentum-tail jitter is a few px and never reaches the commit distance.
  const wheel = useRef<{ dx: number; dir: number; reverse: number; lastAbs: number; timer: ReturnType<typeof setTimeout> | null }>({ dx: 0, dir: 0, reverse: 0, lastAbs: 0, timer: null });
  const idleMs = parseDuration(returnHomeAfter);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linger = useRef<ReturnType<typeof setTimeout> | null>(null);

  const go = useCallback((to: number) => {
    const clamped = Math.max(0, Math.min(ids.length - 1, to));
    setActive(ids[clamped]);
    setRecentlyChanged(true);
    if (linger.current) clearTimeout(linger.current);
    linger.current = setTimeout(() => setRecentlyChanged(false), DOTS_LINGER_MS);
  }, [ids]);

  /** A gesture-driven move. Once a page is locked in, the next gesture counts at once. */
  const swipeTo = go;

  useEffect(() => () => { if (linger.current) clearTimeout(linger.current); }, []);

  // Idle: back to home.
  useEffect(() => {
    if (idleMs === null) return;
    const arm = () => {
      if (idle.current) clearTimeout(idle.current);
      idle.current = setTimeout(() => setActive(home), idleMs);
    };
    arm();
    const events = ["pointerdown", "keydown", "wheel"] as const;
    for (const e of events) window.addEventListener(e, arm, { passive: true });
    return () => {
      if (idle.current) clearTimeout(idle.current);
      for (const e of events) window.removeEventListener(e, arm);
    };
  }, [idleMs, home, active]);

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index]);

  // A release outside the track, or losing the window, still ends the drag.
  useEffect(() => {
    const end = () => { drag.current = null; setGesturing(false); };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
    };
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    if (!e.isPrimary) return;
    const el = e.target as Element;
    const rule = el.closest?.("[data-swipe]")?.getAttribute("data-swipe");
    if (rule === "off" || (rule === "touch" && e.pointerType !== "touch")) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null, spent: false };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || d.spent) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.axis === null) {
      if (Math.hypot(dx, dy) < AXIS_LOCK_PX) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (d.axis === "x") setGesturing(true);
    }
    if (d.axis !== "x" || Math.abs(dx) < DRAG_COMMIT_PX) return;
    d.spent = true;
    swipeTo(index - Math.sign(dx));
  }

  function onPointerEnd(e: React.PointerEvent) {
    if (drag.current && drag.current.id === e.pointerId) { drag.current = null; setGesturing(false); }
  }

  function onWheel(e: React.WheelEvent) {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const w = wheel.current;
    const sign = Math.sign(e.deltaX);
    if (w.timer) clearTimeout(w.timer);
    w.timer = setTimeout(() => { w.dx = 0; w.dir = 0; w.reverse = 0; w.lastAbs = 0; setGesturing(false); }, WHEEL_GESTURE_GAP_MS);
    const abs = Math.abs(e.deltaX);
    const prevAbs = w.lastAbs;
    w.lastAbs = abs;
    if (w.dir !== 0) {
      // This gesture already moved a page: its momentum tail is spent. A real swipe the other way
      // counts as soon as it has travelled the commit distance on its own, tail or not. A fresh push
      // the same way shows as a delta several times the decaying tail's, and starts a new gesture.
      if (sign === w.dir) {
        w.reverse = 0;
        if (abs >= NEW_PUSH_MIN_PX && abs >= prevAbs * NEW_PUSH_RATIO) { w.dir = 0; w.dx = 0; }
        else return;
      } else {
        w.reverse += e.deltaX;
        if (Math.abs(w.reverse) < WHEEL_COMMIT_PX) return;
        w.reverse = 0;
        w.dir = sign;
        swipeTo(index + sign);
        return;
      }
    }
    w.dx += e.deltaX;
    setGesturing(true);
    if (Math.abs(w.dx) < WHEEL_COMMIT_PX) return;
    w.dir = sign;
    w.dx = 0;
    swipeTo(index + sign);
  }

  const trackStyle: CSSProperties = {
    transform: `translateX(${-index * 100}%)`,
    transition: `transform ${SLIDE_MS}ms ${SLIDE_EASING}`,
  };
  const dotsVisible = gesturing || recentlyChanged;

  return (
    <ActivePage.Provider value={active}>
      {/* overflow-hidden: the track is three pages wide, and the document must never scroll sideways under a swipe. */}
      <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-canvas">
        <div
          data-testid="pages-track"
          className="flex min-h-0 min-w-0 flex-1 flex-row touch-pan-y"
          style={trackStyle}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onWheel={onWheel}
        >
          {/* Each slide is exactly one viewport wide; min-w-0 stops wide content from growing the slide. */}
          {pages.map((p) => <div key={p.props.id} className="flex h-full w-full min-w-0 shrink-0 flex-col overflow-hidden p-4">{p}</div>)}
        </div>
        {pages.length > 1 && (
          <div
            role="tablist"
            aria-label="Pages"
            data-visible={dotsVisible}
            className={`pointer-events-none absolute inset-x-0 bottom-[0.6em] flex items-center justify-center gap-[0.6em] transition-opacity duration-300 ${dotsVisible ? "opacity-100" : "opacity-0"}`}
          >
            {pages.map((p) => (
              <button
                key={p.props.id}
                type="button"
                role="tab"
                aria-label={p.props.title}
                aria-selected={active === p.props.id}
                onClick={() => go(ids.indexOf(p.props.id))}
                className="pointer-events-auto flex size-[1.75em] items-center justify-center rounded-full"
              >
                <span className={`block rounded-full transition-all duration-300 ${active === p.props.id ? "size-[0.5em] bg-ink" : "size-[0.4em] bg-ink/30"}`} />
              </button>
            ))}
          </div>
        )}
      </div>
    </ActivePage.Provider>
  );
}
