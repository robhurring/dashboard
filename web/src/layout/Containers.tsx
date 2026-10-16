import type { CSSProperties, ReactNode } from "react";

export type Size = string | number | undefined;

/** Flex sizing for a child: a percent or px/rem is fixed, a number is a share, nothing is an equal share. */
export function flexFor(size: Size): CSSProperties {
  const base = { minWidth: 0, minHeight: 0 };
  if (size === undefined) return { flex: "1 1 0", ...base };
  if (typeof size === "number") return { flex: `${size} 1 0`, ...base };
  if (/^\d+(\.\d+)?(%|px|rem)$/.test(size)) return { flex: `0 0 ${size}`, ...base };
  return { flex: "1 1 0", ...base };
}

export function Row({ gap = 4, children }: { gap?: number; children?: ReactNode }) {
  return <div className="flex min-h-0 min-w-0 flex-1 flex-row" style={{ gap: `${gap * 0.25}rem` }}>{children}</div>;
}

export function Column({ gap = 4, children }: { gap?: number; children?: ReactNode }) {
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col" style={{ gap: `${gap * 0.25}rem` }}>{children}</div>;
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
