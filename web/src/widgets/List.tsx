import { Children, type ReactNode } from "react";

export function List({ empty, children }: { empty?: string; children?: ReactNode }) {
  if (Children.count(children) === 0) return <p className="text-sm text-ink-muted">{empty ?? "Nothing here"}</p>;
  return <ul className="flex flex-col divide-y divide-white/5">{children}</ul>;
}
