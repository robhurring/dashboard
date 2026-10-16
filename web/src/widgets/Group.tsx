import type { ReactNode } from "react";

export function Group({ direction = "column", gap = 2, children }: { direction?: "row" | "column"; gap?: number; children?: ReactNode }) {
  return (
    <div className={direction === "row" ? "flex min-h-0 flex-row flex-wrap items-start [&>*]:min-w-0 [&>*]:flex-1" : "flex h-full min-h-0 flex-col"} style={{ gap: `${gap * 0.25}rem` }}>
      {children}
    </div>
  );
}
