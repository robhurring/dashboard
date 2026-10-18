import { useEffect, useRef, useState } from "react";
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
  const flip = async () => {
    if (!on_change) return;
    const next = !shown;
    setShown(next);
    setError(null);
    const failed = await on_change(next);
    if (failed) { setShown(!next); setError(failed); }
  };
  const color = colorOf(tone);
  const glyph = shown ? icon : (icon_off ?? icon);
  const common = { type: "button" as const, role: "switch", "aria-checked": shown, "aria-label": label, "data-style": style, "data-orientation": orientation, onClick: flip, "data-swipe": "off" };
  const ease = "duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)]";

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
    const vertical = orientation === "vertical";
    return (
      <div className={vertical ? "flex flex-col items-center gap-[0.5em]" : ""}>
        <button
          {...common}
          className={`relative overflow-hidden rounded-full transition-colors ${ease} ${vertical ? "h-[9em] w-[4.2em]" : "h-[3.6em] w-full"}`}
          style={{ background: shown ? color : "color-mix(in srgb, var(--color-ink) 12%, transparent)" }}
        >
          {!vertical && <span className={`absolute inset-0 flex items-center justify-center font-semibold transition-opacity ${shown ? "text-canvas" : "text-ink-muted"}`}>{label}</span>}
          <span
            className={`absolute flex items-center justify-center rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.35)] transition-all ${ease} ${
              vertical
                ? `left-[0.3em] size-[3.6em] ${shown ? "top-[0.3em]" : "top-[calc(100%-3.9em)]"}`
                : `top-[0.3em] size-[3em] ${shown ? "left-[calc(100%-3.3em)]" : "left-[0.3em]"}`
            }`}
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
      <button {...common} className="flex w-full items-center justify-between gap-[0.75em] text-left">
        {glyph && <Icon name={glyph} size={22} className={shown ? "text-accent" : "text-ink-muted"} />}
        <span className="min-w-0 flex-1">
          <span className="type-row block truncate">{label}</span>
          {sub && <span className="type-sub block truncate">{sub}</span>}
        </span>
        <span className={`relative h-[1.9em] w-[3.15em] shrink-0 rounded-full transition-colors ${ease}`} style={{ background: shown ? color : "color-mix(in srgb, var(--color-ink) 18%, transparent)" }}>
          <span className={`absolute top-[0.15em] size-[1.6em] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.3)] transition-[left] ${ease} ${shown ? "left-[1.4em]" : "left-[0.15em]"}`} />
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
 * A Control Center slider: a fat rounded track that fills as you drag, horizontal or upright. It shows
 * the value while dragging and sends it once, when let go. Arrow keys move it a step at a time.
 */
export function Slider({ label = "", min = 0, max = 100, step = 1, value = 0, unit = "", on_change, orientation = "horizontal", icon }: SliderProps) {
  const [shown, setShown] = useControlled(value);
  const [error, setError] = useState<string | null>(null);
  const dragging = useRef(false);
  const vertical = orientation === "vertical";
  const snap = (v: number) => Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
  const fromPointer = (el: HTMLElement, x: number, y: number) => {
    const r = el.getBoundingClientRect();
    const fraction = vertical ? (r.bottom - y) / (r.height || 1) : (x - r.left) / (r.width || 1);
    return snap(min + Math.min(1, Math.max(0, fraction)) * (max - min));
  };
  const commit = async (v: number) => {
    if (!on_change || v === value) return;
    setError(null);
    const failed = await on_change(v);
    if (failed) { setShown(value); setError(failed); }
  };
  const pct = max > min ? ((shown - min) / (max - min)) * 100 : 0;
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
        className={`relative touch-none overflow-hidden rounded-[1.1em] bg-ink/10 outline-none focus-visible:ring-2 focus-visible:ring-accent ${vertical ? "h-[9em] w-[4.2em]" : "h-[3em] w-full"}`}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setShown(fromPointer(e.currentTarget, e.clientX, e.clientY));
        }}
        onPointerMove={(e) => { if (dragging.current) setShown(fromPointer(e.currentTarget, e.clientX, e.clientY)); }}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          const v = fromPointer(e.currentTarget, e.clientX, e.clientY);
          setShown(v);
          void commit(v);
        }}
        onPointerCancel={() => { dragging.current = false; setShown(value); }}
        onKeyDown={(e) => {
          const delta = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step }[e.key];
          if (delta !== undefined) { e.preventDefault(); setShown(snap(shown + delta)); }
        }}
        onKeyUp={(e) => { if (["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown"].includes(e.key)) void commit(shown); }}
      >
        <div
          className={`absolute bg-ink transition-[width,height] duration-75 ${vertical ? "inset-x-0 bottom-0" : "inset-y-0 left-0"}`}
          style={vertical ? { height: `${pct}%` } : { width: `${pct}%` }}
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
