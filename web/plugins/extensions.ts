/*
 * Extensions: module UIs, themes and widgets that live outside the repo's own folders, found from the
 * same folder lists the server reads (MODULES_DIR, THEMES_DIR, WIDGETS_DIR; colon-separated and
 * searched like $PATH: the first folder with a given name wins). The app imports them all from one generated module,
 * `virtual:dashboard/extensions`, so nothing in src/ hardcodes where they live.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";

export type Folders = { modulesDirs: string[]; themesDirs: string[]; widgetsDirs: string[]; builtinWidgets: readonly string[] };
export type Found = { moduleUis: Record<string, string>; themes: Record<string, string>; widgets: Record<string, string>; skipped: string[] };

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();
const entries = (dir: string) => (isDir(dir) ? readdirSync(dir).sort() : []);

/** What each folder list provides, by name. Pure filesystem reads; no Vite involved. */
export function scan({ modulesDirs, themesDirs, widgetsDirs, builtinWidgets }: Folders): Found {
  const found: Found = { moduleUis: {}, themes: {}, widgets: {}, skipped: [] };
  const seenModules = new Set<string>();
  for (const dir of modulesDirs) {
    for (const name of entries(dir)) {
      if (seenModules.has(name) || !existsSync(path.join(dir, name, "module.lua"))) continue;
      // The first module by this name wins entirely, UI included: if it has no UI, there is none.
      seenModules.add(name);
      const ui = path.join(dir, name, "ui", "index.tsx");
      if (existsSync(ui)) found.moduleUis[name] = ui;
    }
  }
  for (const dir of themesDirs) {
    for (const name of entries(dir)) {
      const index = path.join(dir, name, "index.tsx");
      if (!(name in found.themes) && existsSync(index)) found.themes[name] = index;
    }
  }
  for (const dir of widgetsDirs) {
    for (const entry of entries(dir)) {
      const file = entry.endsWith(".tsx") ? path.join(dir, entry) : path.join(dir, entry, "index.tsx");
      if (!existsSync(file) || entry.endsWith(".test.tsx")) continue;
      const name = entry.replace(/\.tsx$/, "");
      if (!/^[a-z][a-z0-9_]*$/.test(name)) found.skipped.push(`${file}: widget names are lowercase letters, digits and _`);
      else if (builtinWidgets.includes(name)) found.skipped.push(`${file}: ui.${name} is built in`);
      else if (!(name in found.widgets)) found.widgets[name] = file;
    }
  }
  return found;
}

/** "a:b: c::" -> absolute paths, relative ones resolved against the repo root. */
export function pathList(value: string, repoRoot: string): string[] {
  return value.split(":").map((p) => p.trim()).filter(Boolean).map((p) => path.resolve(repoRoot, p));
}

const ID = "virtual:dashboard/extensions";
const RESOLVED = "\0" + ID;

function code(found: Found): string {
  const loaders = (map: Record<string, string>) =>
    "{\n" + Object.entries(map).map(([name, file]) => `  ${JSON.stringify(name)}: () => import(${JSON.stringify(file)}),`).join("\n") + "\n}";
  return [
    `export const moduleUis = ${loaders(found.moduleUis)};`,
    `export const themes = ${loaders(found.themes)};`,
    `export const widgets = ${loaders(found.widgets)};`,
  ].join("\n");
}

export function extensions(folders: Folders): Plugin {
  let found = scan(folders);
  const roots = [...folders.modulesDirs, ...folders.themesDirs, ...folders.widgetsDirs];
  const report = (log: (m: string) => void) => found.skipped.forEach((s) => log(`[dashboard] skipped ${s}`));
  return {
    name: "dashboard-extensions",
    enforce: "pre",
    buildStart() { found = scan(folders); report((m) => this.warn(m)); },
    resolveId(id) { return id === ID ? RESOLVED : undefined; },
    load(id) { return id === RESOLVED ? code(found) : undefined; },
    // Tailwind skips gitignored files (like local/), so name every extension folder as a source.
    transform(src, id) {
      if (!id.endsWith("/src/index.css")) return undefined;
      const sources = roots.filter(isDir).map((dir) => `@source ${JSON.stringify(dir)};`).join("\n");
      return src.replace(/(@import\s+["']tailwindcss["'];?)/, `$1\n${sources}`);
    },
    configureServer(server: ViteDevServer) {
      for (const dir of roots) if (isDir(dir)) server.watcher.add(dir);
      // A new or removed module, theme or widget changes what exists: regenerate and reload.
      const changed = (file: string) => {
        if (!roots.some((r) => file.startsWith(r + path.sep))) return;
        if (!/(module\.lua|index\.tsx|\.tsx)$/.test(file)) return;
        const next = scan(folders);
        if (JSON.stringify(next) === JSON.stringify(found)) return;
        found = next;
        report((m) => server.config.logger.warn(m));
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", changed);
      server.watcher.on("unlink", changed);
    },
  };
}
