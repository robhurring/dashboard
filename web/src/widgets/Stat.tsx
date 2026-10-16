import { Icon } from "./icons";

type Props = { value?: string; label?: string; sub?: string; icon?: string };

export function Stat({ value, label, sub, icon }: Props) {
  return (
    <div className="flex items-start gap-[0.75em]">
      {icon && <Icon name={icon} className="size-[2.25em] shrink-0 text-accent" />}
      <div className="min-w-0">
        <div className="type-value truncate">{value}</div>
        {label && <div className="type-label mt-[0.25em] truncate">{label}</div>}
        {sub && <div className="type-sub truncate">{sub}</div>}
      </div>
    </div>
  );
}
