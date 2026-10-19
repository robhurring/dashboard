import { Children, isValidElement, useState, type ReactElement, type ReactNode } from "react";

type TabProps = { title: string; children?: ReactNode };

/** One tab of a <Tabs>: its title goes in the segmented control. */
export function Tab({ children }: TabProps) {
  return <>{children}</>;
}

const key = (id: string) => `dashboard.tabs.${id}`;

function remembered(id: string | undefined, titles: string[]): number {
  if (!id) return 0;
  try {
    const i = titles.indexOf(localStorage.getItem(key(id)) ?? "");
    return i < 0 ? 0 : i;
  } catch {
    return 0;
  }
}

/**
 * Several panels in one place, picked with an iOS segmented control. Every tab stays mounted, so its
 * modules keep their data and switching is instant; the others are hidden. With `id`, the chosen tab
 * survives a reload.
 */
export function Tabs({ id, children }: { id?: string; children?: ReactNode }) {
  const tabs = Children.toArray(children).filter((c): c is ReactElement<TabProps> => isValidElement(c) && c.type === Tab);
  const titles = tabs.map((t) => t.props.title);
  const [active, setActive] = useState(() => remembered(id, titles));
  const pick = (i: number) => {
    setActive(i);
    if (id) try { localStorage.setItem(key(id), titles[i]); } catch { /* private mode: not remembered */ }
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-[0.6em]">
      <div data-swipe="off" className="flex shrink-0">
        <div role="tablist" className="flex gap-[0.2em] rounded-[0.7em] bg-ink/10 p-[0.2em]">
          {titles.map((title, i) => (
            <button
              key={title}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => pick(i)}
              className={`rounded-[0.55em] px-[0.9em] py-[0.3em] text-[0.875em] font-semibold transition-colors duration-200 ${i === active ? "bg-ink/20 text-ink shadow-[0_1px_3px_rgba(0,0,0,0.3)]" : "text-ink-muted"}`}
            >
              {title}
            </button>
          ))}
        </div>
      </div>
      {tabs.map((tab, i) => (
        <div key={tab.props.title} role="tabpanel" aria-label={tab.props.title} hidden={i !== active} className={i === active ? "flex min-h-0 flex-1 flex-col" : undefined}>
          {tab}
        </div>
      ))}
    </div>
  );
}
