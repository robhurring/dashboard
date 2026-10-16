import { defineConfig, loadEnv, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { extensions, pathList } from "./plugins/extensions.ts";
import { BUILTIN_WIDGETS } from "./src/widgets/names.ts";
import pkg from "./package.json" with { type: "json" };

const repoRoot = path.resolve(import.meta.dirname, "..");

export default defineConfig(({ mode }) => {
  // The same folder lists the server reads, from the environment or the repo's .env.
  const env = { ...loadEnv(mode, repoRoot, ""), ...process.env };
  const folders = {
    modulesDirs: pathList(env.MODULES_DIR || "local/modules:modules", repoRoot),
    themesDirs: pathList(env.THEMES_DIR || "local/themes:web/themes", repoRoot),
    widgetsDirs: pathList(env.WIDGETS_DIR || "local/widgets", repoRoot),
    builtinWidgets: BUILTIN_WIDGETS,
  };
  return {
    plugins: [extensions(folders), react(), tailwindcss()],
    define: { __DEFAULT_THEME__: JSON.stringify(env.DEFAULT_THEME || "home") },
    resolve: {
      // Module UIs in ../modules are reached through the web/modules symlink; keeping that path lets them
      // resolve packages from web/node_modules. Extensions elsewhere get the same packages through dedupe.
      preserveSymlinks: true,
      dedupe: Object.keys(pkg.dependencies),
      alias: { "@dashboard": path.resolve(import.meta.dirname, "src") },
    },
    server: {
      port: 5173,
      fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...folders.modulesDirs, ...folders.themesDirs, ...folders.widgetsDirs] },
      // Extra host names the dev server may be reached by (a headless browser in Docker, say): "a,b".
      allowedHosts: (process.env.DASHBOARD_ALLOWED_HOSTS ?? "").split(",").filter(Boolean),
      proxy: {
        "/ws": { target: `ws://${process.env.DASHBOARD_SERVER ?? "127.0.0.1:4000"}`, ws: true },
        "/healthz": `http://${process.env.DASHBOARD_SERVER ?? "127.0.0.1:4000"}`,
        "/hooks": `http://${process.env.DASHBOARD_SERVER ?? "127.0.0.1:4000"}`,
      },
    },
  };
});
