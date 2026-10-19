import { Children, createContext, isValidElement, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export type Size = string | number | undefined;

/** Flex sizing for a child: a percent or px/rem is fixed, a number is a share, nothing is an equal share. */
export function flexFor(size: Size): CSSProperties {
  const base = { minWidth: 0, minHeight: 0 };
  if (size === undefined) return { flex: "1 1 0", ...base };
  if (typeof size === "number") return { flex: `${size} 1 0`, ...base };
  if (/^\d+(\.\d+)?(%|px|rem)$/.test(size)) return { flex: `0 0 ${size}`, ...base };
  return { flex: "1 1 0", ...base };
}

/** `size` sets its share of the row or column it sits in, as a slot's does; without one, an equal share. */
export function Row({ gap = 4, size, children }: { gap?: number; size?: Size; children?: ReactNode }) {
  return <div className="flex min-h-0 min-w-0 flex-1 flex-row" style={{ gap: `${gap * 0.25}rem`, ...(size !== undefined ? flexFor(size) : {}) }}>{children}</div>;
}

export function Column({ gap = 4, size, children }: { gap?: number; size?: Size; children?: ReactNode }) {
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col" style={{ gap: `${gap * 0.25}rem`, ...(size !== undefined ? flexFor(size) : {}) }}>{children}</div>;
}

/** Rows of `unit` px (with `gap` px between) that `height` px of content needs: at least one. */
export function flowRows(height: number, unit: number, gap: number): number {
  return Math.max(1, Math.ceil((height + gap) / (unit + gap) - 1e-6));
}

/** CSS height of an item spanning `rows` rows of a Flow with this `unit` and `gap`, for items that fill a fixed size (gauges, charts). */
export function flowHeight(rows: number, unit = 10, gap = 6): string {
  return `${rows * unit + (rows - 1) * gap * 0.25}rem`;
}

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

const FlowContext = createContext({ unit: 10, gap: 6 });

/** True inside a Tile that sizes to its content: a Slot there takes its module's height rather than a share of the space. */
export const InMeasuredTile = createContext(false);

/** Apple-widget sizes, as [columns, rows] of a Flow. */
const TILE_SIZES = { small: [1, 1], medium: [2, 1], large: [2, 2] } as const;

type TileProps = { size?: keyof typeof TILE_SIZES; cols?: number; rows?: number; children?: ReactNode };

/**
 * A panel's place in a Flow. `size` is small (1x1), medium (2x1, wide) or large (2x2), or give `cols` and
 * `rows`. Without either, it's one column wide and spans the rows its content needs.
 */
export function Tile({ size, cols, rows, children }: TileProps) {
  const { unit, gap } = useContext(FlowContext);
  const fixed = rows ?? (size && TILE_SIZES[size][1]);
  const span = cols ?? (size ? TILE_SIZES[size][0] : 1);
  const ref = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (fixed || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const rem = remPx();
      setMeasured(flowRows(el.getBoundingClientRect().height, unit * rem, gap * 0.25 * rem));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixed, unit, gap]);
  const style = fixed
    ? { gridColumn: `span ${span}`, gridRow: `span ${fixed}`, height: flowHeight(fixed, unit, gap) }
    // Measured: starts at its content's height; the min-height then fills the rows it spans, which
    // measures back to the same span.
    : { gridColumn: `span ${span}`, gridRow: `span ${measured}`, minHeight: flowHeight(measured, unit, gap), alignSelf: "start" };
  return (
    <div ref={ref} className="flex min-h-0 min-w-0 flex-col [&>*]:min-h-0 [&>*]:flex-1" style={style}>
      <InMeasuredTile.Provider value={!fixed}>{children}</InMeasuredTile.Provider>
    </div>
  );
}

/**
 * The default for a page of panels: equal columns (each at least `width` rem) on rows of `unit` rem, like
 * a home screen of widgets. Short panels stack beside tall ones edge to edge, and gaps get packed. Wrap
 * a child in <Tile> to size it; others size to their content. Use Row, Column or Grid where a layout
 * needs exact placement.
 */
export function Flow({ width = 22, unit = 10, gap = 6, children }: { width?: number; unit?: number; gap?: number; children?: ReactNode }) {
  return (
    <FlowContext.Provider value={{ unit, gap }}>
      <div
        className="min-h-0 min-w-0"
        style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${width}rem), 1fr))`, gridAutoRows: `${unit}rem`, gap: `${gap * 0.25}rem`, gridAutoFlow: "row dense" }}
      >
        {Children.map(children, (child) => (child == null ? null : isValidElement(child) && child.type === Tile ? child : <Tile>{child}</Tile>))}
      </div>
    </FlowContext.Provider>
  );
}

export function Grid({ areas, columns, rows, gap = 4, children }: { areas: string[]; columns?: string; rows?: string; gap?: number; children?: ReactNode }) {
  return (
    <div
      className="grid min-h-0 flex-1"
      style={{ gridTemplateAreas: areas.map((r) => `"${r}"`).join(" "), gridTemplateColumns: columns, gridTemplateRows: rows, gap: `${gap * 0.25}rem` }}
    >
      {children}
    </div>
  );
}
