import type { ReactNode } from "react";
import { Icon } from "./icons";
import { Inline } from "./Inline";

type Props = {
  text?: string;
  /** Details: text, or any content (a badge, a spinner) when used from React. */
  sub?: ReactNode;
  icon?: string;
  align?: "left" | "center" | "right";
  /**
   * Details under the title, beside it (to the right when left-aligned, to the left when
   * right-aligned), or at the far end of the line, as a panel header puts its status.
   */
  details?: "below" | "beside" | "end";
  /** `caption` is the small, muted heading at the top of a panel. */
  size?: "caption" | "small" | "medium" | "large";
};

const SIZE = { caption: "type-title font-normal", small: "text-[1.1em] font-semibold", medium: "text-[1.45em] font-semibold", large: "text-[1.9em] font-semibold" };

/**
 * A heading for a page, a group of panels or a panel itself: no background. Left, center or right
 * aligned, with optional details below it, beside it or at the far end. Lua views use it as ui.title;
 * themes as <Title>; every panel header is one.
 */
export function Title({ text = "", sub, icon, align = "left", details = "below", size = "large" }: Props) {
  const layout = details === "below" || align === "center" ? "below" : details;
  const justify = align === "center" ? "items-center text-center" : align === "right" ? "items-end text-right" : "items-start text-left";
  const caption = size === "caption";
  const heading = (
    <h2 className={`flex min-w-0 items-center gap-[0.4em] leading-tight tracking-tight ${SIZE[size]}`}>
      {icon && (caption ? <Icon name={icon} className="size-[1.15em] shrink-0 text-accent" /> : <Icon name={icon} size={24} className="shrink-0 text-accent" />)}
      <span className={caption ? "truncate" : ""}><Inline text={text} /></span>
    </h2>
  );
  const detail = sub != null && sub !== false && sub !== "" && (
    typeof sub === "string" ? <span className={`type-sub ${layout === "end" ? "ml-auto shrink-0" : ""}`}><Inline text={sub} /></span> : <span className={`flex items-center gap-2 ${layout === "end" ? "ml-auto shrink-0" : ""}`}>{sub}</span>
  );
  const row = layout === "end" ? "items-center gap-2" : `items-baseline gap-[0.75em] ${align === "right" ? "flex-row-reverse justify-start" : ""}`;
  return (
    <div data-align={align} data-details={layout} data-size={size} className={`flex min-w-0 ${layout === "below" ? `flex-col gap-[0.15em] ${justify}` : row}`}>
      {heading}
      {detail}
    </div>
  );
}
