import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { extensions } from "./plugins/extensions.ts";
import { BUILTIN_WIDGETS } from "./src/widgets/names.ts";
import pkg from "./package.json" with { type: "json" };

const repoRoot = path.resolve(import.meta.dirname, "..");

export default defineConfig({
  // The app under test sees only the repo's own modules and themes. Tests that ship with local/
  // extensions still run, against their own components.
  plugins: [extensions({ modulesDirs: [path.join(repoRoot, "modules")], themesDirs: [path.join(repoRoot, "web/themes")], widgetsDirs: [], builtinWidgets: BUILTIN_WIDGETS }), react()],
  server: { fs: { allow: [repoRoot] } },
  resolve: { preserveSymlinks: true, dedupe: [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)], alias: { "@dashboard": path.resolve(import.meta.dirname, "src") } },
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], include: ["src/**/*.test.{ts,tsx}", "plugins/**/*.test.ts", "modules/*/ui/**/*.test.{ts,tsx}", "../local/**/*.test.{ts,tsx}"] },
});
