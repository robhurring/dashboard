import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { LoaderCircle } from "lucide-react";
import { Icon } from "./icons";
import { colorOf } from "./Charts";
import type { Handler } from "./WidgetTree";

/*
 * Controls a module's view can use to act, not just show. Each runs one of the module's commands; the
 * value a control sets joins that command's args as `value`. They respond at once, then follow the
 * module's next state; if the command fails, they go back and say why.
 */

function Failure({ error }: { error: string | null }) {
  return error ? <p role="alert" className="type-sub mt-[0.3em] text-bad">{error}</p> : null;
}

/** Keeps a control's shown value in step with the module's, while letting a tap show its result at once. */
function useControlled<T>(value: T): [T, (v: T) => void] {
  const [shown, setShown] = useState(value);
  useEffect(() => setShown(value), [value]);
  return [shown, setShown];
}

type ButtonProps = { label?: string; icon?: string; on_tap?: Handler };

export function Button({ label = "", icon, on_tap }: ButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tap = async () => {
    if (!on_tap || busy) return;
    setBusy(true);
    setError(null);
    setError(await on_tap());
    setBusy(false);
  };
  return (
    <div>
      <button
        type="button"
        onClick={tap}
        aria-label={label}
        className="flex min-h-[2.75em] items-center justify-center gap-[0.5em] rounded-xl bg-ink/10 px-[1.1em] font-semibold transition-colors active:bg-ink/20 disabled:opacity-60"
        disabled={busy}
      >
        {busy ? <LoaderCircle className="size-[1.1em] animate-spin" aria-hidden /> : icon && <Icon name={icon} size={18} className="text-accent" />}
        {label}
      </button>
      <Failure error={error} />
    </div>
  );
}

/**
 * Lets a switch's knob be dragged like iOS: it follows the finger along the track and, let go, lands on
 * whichever side it's nearer. A drag doesn't count as a tap; a tap (or Enter/Space) still flips it.
 * `position` is 0 (off) to 1 (on).
 */
function useKnobDrag(shown: boolean, setTo: (on: boolean) => void, flip: () => void, vertical: boolean) {
  const track = useRef<HTMLElement>(null);
  const knob = useRef<HTMLElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ x: number; y: number; from: number; travel: number } | null>(null);
  const dragged = useRef(false);
  const at = (e: PointerEvent) => {
    const s = start.current!;
    const moved = vertical ? s.y - e.clientY : e.clientX - s.x;
    return { moved, position: Math.min(1, Math.max(0, s.from + moved / (s.travel || 1))) };
  };
  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      const t = track.current, k = knob.current;
      if (!t || !k) return;
      const tr = t.getBoundingClientRect(), kr = k.getBoundingClientRect();
      const inset = vertical ? k.offsetLeft : k.offsetTop;
      const travel = vertical ? tr.height - kr.height - 2 * inset : tr.width - kr.width - 2 * inset;
      start.current = { x: e.clientX, y: e.clientY, from: shown ? 1 : 0, travel };
      dragged.current = false;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: PointerEvent) => {
      if (!start.current) return;
      const { moved, position } = at(e);
      if (!dragged.current && Math.abs(moved) < 4) return;
      dragged.current = true;
      setDrag(position);
    },
    onPointerUp: (e: PointerEvent) => {
      if (!start.current) return;
      const { position } = at(e);
      start.current = null;
      setDrag(null);
      if (dragged.current && position >= 0.5 !== shown) setTo(position >= 0.5);
    },
    onPointerCancel: () => { start.current = null; dragged.current = false; setDrag(null); },
    // The click that ends a drag isn't a tap.
    onClick: () => { if (dragged.current) { dragged.current = false; return; } flip(); },
  };
  const position = drag ?? (shown ? 1 : 0);
  return { track, knob, handlers, position, dragging: drag !== null, knobProps: { "data-knob": true, "data-position": String(+position.toFixed(3)) } };
}

type ToggleProps = {
  label?: string; sub?: string; on?: boolean; on_change?: Handler;
  icon?: string; icon_off?: string; style?: "switch" | "slide" | "tile"; orientation?: "horizontal" | "vertical"; tone?: string;
};

/**
 * On or off, three ways: an iOS switch in a row (default), a big pill to slide (`style = "slide"`, upright
 * with `orientation = "vertical"`, like a wall switch), or a Control Center tile that lights up
 * (`style = "tile"`). `icon` shows the thing; `icon_off` swaps in while it's off. Green when on, or `tone`.
 */
export function Toggle({ label = "", sub, on = false, on_change, icon, icon_off, style = "switch", orientation = "horizontal", tone = "good" }: ToggleProps) {
  const [shown, setShown] = useControlled(on);
  const [error, setError] = useState<string | null>(null);
  const setTo = async (next: boolean) => {
    if (!on_change) return;
    setShown(next);
    setError(null);
    const failed = await on_change(next);
    if (failed) { setShown(!next); setError(failed); }
  };
  const flip = () => void setTo(!shown);
  const vertical = orientation === "vertical";
  const { track, knob, handlers, position, dragging, knobProps } = useKnobDrag(shown, (v) => void setTo(v), flip, style === "slide" && vertical);
  // While dragging, the label reads "on" once the knob is past halfway.
  const lit = dragging ? position >= 0.5 : shown;
  const off = "color-mix(in srgb, var(--color-ink) 12%, transparent)";
  const ease = "duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)]";
  // The color fills the track up to the knob and follows it, as on iOS: none at off, all of it at on.
  const glide = dragging ? "" : `transition-[width,height] ${ease}`;
  const color = colorOf(tone);
  const glyph = shown ? icon : (icon_off ?? icon);
  const common = { type: "button" as const, role: "switch", "aria-checked": shown, "aria-label": label, "data-style": style, "data-orientation": orientation, onClick: flip, "data-swipe": "off" };

  if (style === "tile") {
    return (
      <div>
        <button {...common} className={`flex aspect-square w-full max-w-[9em] flex-col justify-between rounded-[1.4em] p-[0.9em] text-left transition-colors ${ease} ${shown ? "bg-ink text-canvas" : "bg-ink/10 text-ink"}`}>
          <span className="flex size-[2.4em] items-center justify-center rounded-full" style={{ background: shown ? color : "color-mix(in srgb, var(--color-ink) 15%, transparent)" }}>
            {glyph && <Icon name={glyph} size={20} className={shown ? "text-canvas" : "text-ink"} />}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold">{label}</span>
            <span className={`block truncate text-[0.8em] ${shown ? "text-canvas/70" : "text-ink-muted"}`}>{sub ?? (shown ? "On" : "Off")}</span>
          </span>
        </button>
        <Failure error={error} />
      </div>
    );
  }

  if (style === "slide") {
    return (
      <div className={vertical ? "flex flex-col items-center gap-[0.5em]" : ""}>
        <button
          {...common}
          {...handlers}
          ref={track as RefObject<HTMLButtonElement>}
          data-track
          className={`relative touch-none select-none overflow-hidden rounded-full transition-colors ${ease} ${vertical ? "h-[9em] w-[4.2em]" : "h-[3.6em] w-full"}`}
          style={{ background: off }}
        >
          <span
            data-fill
            className={`absolute rounded-full ${glide} ${vertical ? "inset-x-0 bottom-0" : "inset-y-0 left-0"}`}
            style={{ background: color, ...(vertical ? { height: `calc(4.2em + ${position} * (100% - 4.2em))` } : { width: `calc(3.6em + ${position} * (100% - 3.6em))` }) }}
          />
          {!vertical && <span className={`absolute inset-0 flex items-center justify-center font-semibold transition-opacity ${lit ? "text-canvas" : "text-ink-muted"}`}>{label}</span>}
          <span
            ref={knob}
            {...knobProps}
            className={`absolute flex items-center justify-center rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.35)] ${dragging ? "" : `transition-[left,top] ${ease}`} ${vertical ? "left-[0.3em] size-[3.6em]" : "top-[0.3em] size-[3em]"}`}
            style={vertical ? { top: `calc(100% - 3.9em - ${position} * (100% - 4.2em))` } : { left: `calc(0.3em + ${position} * (100% - 3.6em))` }}
          >
            {glyph && <Icon name={glyph} size={20} className="text-black/70" />}
          </span>
        </button>
        {vertical && <span className="type-row text-center">{label}</span>}
        <Failure error={error} />
      </div>
    );
  }

  return (
    <div>
      <button {...common} {...handlers} className="flex w-full touch-pan-y select-none items-center justify-between gap-[0.75em] text-left">
        {glyph && <Icon name={glyph} size={22} className={shown ? "text-accent" : "text-ink-muted"} />}
        <span className="min-w-0 flex-1">
          <span className="type-row block truncate">{label}</span>
          {sub && <span className="type-sub block truncate">{sub}</span>}
        </span>
        <span ref={track} data-track className="relative h-[1.9em] w-[3.15em] shrink-0 overflow-hidden rounded-full" style={{ background: "color-mix(in srgb, var(--color-ink) 18%, transparent)" }}>
          <span data-fill className={`absolute inset-y-0 left-0 rounded-full ${glide}`} style={{ background: color, width: `calc(1.9em + ${position} * 1.25em)` }} />
          <span
            ref={knob}
            {...knobProps}
            className={`absolute top-[0.15em] size-[1.6em] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.3)] ${dragging ? "" : `transition-[left] ${ease}`}`}
            style={{ left: `calc(0.15em + ${position} * 1.25em)` }}
          />
        </span>
      </button>
      <Failure error={error} />
    </div>
  );
}

type SliderProps = {
  label?: string; min?: number; max?: number; step?: number; value?: number; unit?: string; on_change?: Handler;
  orientation?: "horizontal" | "vertical"; icon?: string;
};

/**
 * A Control Center slider: a fat rounded track that fills as you drag, horizontal or upright. The fill
 * follows the finger exactly while the value snaps to `step`; let go, the fill settles on the step and
 * the value is sent once. Arrow keys move it a step at a time.
 */
export function Slider({ label = "", min = 0, max = 100, step = 1, value = 0, unit = "", on_change, orientation = "horizontal", icon }: SliderProps) {
  const [shown, setShown] = useControlled(value);
  const [error, setError] = useState<string | null>(null);
  // The raw position under the finger (0..1) while dragging; null otherwise.
  const [drag, setDrag] = useState<number | null>(null);
  const vertical = orientation === "vertical";
  const snap = (v: number) => Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
  const fractionAt = (el: HTMLElement, x: number, y: number) => {
    const r = el.getBoundingClientRect();
    const fraction = vertical ? (r.bottom - y) / (r.height || 1) : (x - r.left) / (r.width || 1);
    return Math.min(1, Math.max(0, fraction));
  };
  const valueAt = (fraction: number) => snap(min + fraction * (max - min));
  const follow = (el: HTMLElement, x: number, y: number) => {
    const f = fractionAt(el, x, y);
    setDrag(f);
    setShown(valueAt(f));
    return f;
  };
  const commit = async (v: number) => {
    if (!on_change || v === value) return;
    setError(null);
    const failed = await on_change(v);
    if (failed) { setShown(value); setError(failed); }
  };
  const fill = drag ?? (max > min ? (shown - min) / (max - min) : 0);
  const offset = +((1 - fill) * 100).toFixed(3);
  const readout = <span className="type-label tabular-nums">{Number.isInteger(shown) ? shown : shown.toFixed(1)}{unit}</span>;
  return (
    <div className={vertical ? "flex flex-col items-center gap-[0.5em]" : ""}>
      {!vertical && <div className="mb-[0.4em] flex items-baseline justify-between gap-3"><span className="type-row">{label}</span>{readout}</div>}
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={shown}
        data-swipe="off"
        className={`relative touch-none select-none overflow-hidden rounded-[1.1em] bg-ink/10 outline-none focus-visible:ring-2 focus-visible:ring-accent ${vertical ? "h-[9em] w-[4.2em]" : "h-[3em] w-full"}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          follow(e.currentTarget, e.clientX, e.clientY);
        }}
        onPointerMove={(e) => { if (drag !== null) follow(e.currentTarget, e.clientX, e.clientY); }}
        onPointerUp={(e) => {
          if (drag === null) return;
          const v = valueAt(fractionAt(e.currentTarget, e.clientX, e.clientY));
          setDrag(null);
          setShown(v);
          void commit(v);
        }}
        onPointerCancel={() => { setDrag(null); setShown(value); }}
        onKeyDown={(e) => {
          const delta = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step }[e.key];
          if (delta !== undefined) { e.preventDefault(); setShown(snap(shown + delta)); }
        }}
        onKeyUp={(e) => { if (["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown"].includes(e.key)) void commit(shown); }}
      >
        {/* Moved with a transform, not resized: no layout per frame. Glides to the step when let go, never while dragging. */}
        <div
          data-fill
          data-dragging={drag !== null}
          className={`absolute inset-0 bg-ink will-change-transform ${drag !== null ? "" : "transition-transform duration-200 ease-out"}`}
          style={{ transform: vertical ? `translateY(${offset}%)` : `translateX(-${offset}%)` }}
        />
        {icon && (
          <span className={`absolute ${vertical ? "bottom-[0.8em] left-1/2 -translate-x-1/2" : "left-[0.9em] top-1/2 -translate-y-1/2"} mix-blend-difference`}>
            <Icon name={icon} size={22} className="text-white" />
          </span>
        )}
      </div>
      {vertical && <div className="flex flex-col items-center"><span className="type-row">{label}</span>{readout}</div>}
      <Failure error={error} />
    </div>
  );
}

type Option = string | { value: string; label?: string };
type ChoiceProps = { label?: string; options?: Option[]; value?: string; on_change?: Handler };

export function Choice({ label, options = [], value, on_change }: ChoiceProps) {
  const [shown, setShown] = useControlled(value);
  const [error, setError] = useState<string | null>(null);
  const pick = async (next: string) => {
    if (!on_change || next === shown) return;
    const before = shown;
    setShown(next);
    setError(null);
    const failed = await on_change(next);
    if (failed) { setShown(before); setError(failed); }
  };
  return (
    <div>
      {label && <div className="type-row mb-[0.4em]">{label}</div>}
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-[0.4em]">
        {options.map((o) => {
          const v = typeof o === "string" ? o : o.value;
          const text = typeof o === "string" ? o : (o.label ?? o.value);
          const on = v === shown;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={text}
              onClick={() => pick(v)}
              className={`min-h-[2.4em] rounded-xl px-[0.9em] font-semibold transition-colors ${on ? "bg-accent text-canvas" : "bg-ink/10 active:bg-ink/20"}`}
            >
              {text}
            </button>
          );
        })}
      </div>
      <Failure error={error} />
    </div>
  );
}
