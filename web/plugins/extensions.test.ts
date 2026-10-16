import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { scan } from "./extensions";

function tree(files: string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), "ext-"));
  for (const f of files) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), "");
  }
  return root;
}

describe("scan", () => {
  test("later folders override earlier ones; a module without a UI drops the earlier UI", () => {
    const root = tree([
      "base/clock/module.lua", "base/clock/ui/index.tsx",
      "base/todo/module.lua", "base/todo/ui/index.tsx",
      "mine/clock/module.lua", "mine/clock/ui/index.tsx",
      "mine/todo/module.lua",
      "mine/extra/module.lua", "mine/extra/ui/index.tsx",
      "themes/wall/index.tsx", "local-themes/wall/index.tsx", "local-themes/kitchen/index.tsx",
      "widgets/sparkle/index.tsx", "widgets/moon.tsx", "widgets/Bad-Name.tsx", "widgets/stat.tsx",
    ]);
    const r = (p: string) => path.join(root, p);
    const found = scan({
      modulesDirs: [r("base"), r("missing"), r("mine")],
      themesDirs: [r("themes"), r("local-themes")],
      widgetsDirs: [r("widgets")],
      builtinWidgets: ["stat", "ticker"],
    });
    expect(found.moduleUis).toEqual({ clock: r("mine/clock/ui/index.tsx"), extra: r("mine/extra/ui/index.tsx") });
    expect(found.themes).toEqual({ wall: r("local-themes/wall/index.tsx"), kitchen: r("local-themes/kitchen/index.tsx") });
    expect(found.widgets).toEqual({ sparkle: r("widgets/sparkle/index.tsx"), moon: r("widgets/moon.tsx") });
    expect(found.skipped.sort()).toEqual([
      `${r("widgets/Bad-Name.tsx")}: widget names are lowercase letters, digits and _`,
      `${r("widgets/stat.tsx")}: ui.stat is built in`,
    ].sort());
  });
});
