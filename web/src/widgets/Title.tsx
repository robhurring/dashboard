import { Icon } from "./icons";

type Props = {
  text?: string;
  sub?: string;
  icon?: string;
  align?: "left" | "center" | "right";
  /** Details under the title, or beside it: to the right when left-aligned, to the left when right-aligned. */
  details?: "below" | "beside";
  size?: "small" | "medium" | "large";
};

const SIZE = { small: "text-[1.1em]", medium: "text-[1.45em]", large: "text-[1.9em]" };

/**
 * A heading for a page or a group of panels: no panel, no background. Left, center or right aligned,
 * with optional details below it or beside it. Lua views use it as ui.title; themes as <Title>.
 */
export function Title({ text = "", sub, icon, align = "left", details = "below", size = "large" }: Props) {
  const beside = details === "beside" && align !== "center";
  const justify = align === "center" ? "items-center text-center" : align === "right" ? "items-end text-right" : "items-start text-left";
  const heading = (
    <h2 className={`flex items-center gap-[0.4em] font-semibold leading-tight tracking-tight ${SIZE[size]}`}>
      {icon && <Icon name={icon} size={24} className="shrink-0 text-accent" />}
      <span>{text}</span>
    </h2>
  );
  const detail = sub && <span className="type-sub">{sub}</span>;
  return (
    <div data-align={align} data-details={beside ? "beside" : "below"} className={`flex min-w-0 ${beside ? `items-baseline gap-[0.75em] ${align === "right" ? "flex-row-reverse justify-start" : ""}` : `flex-col gap-[0.15em] ${justify}`}`}>
      {heading}
      {detail}
    </div>
  );
}
