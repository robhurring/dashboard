import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Module UIs live in ../modules, reached through the web/modules symlink. Keeping the symlinked
  // path lets them resolve react and friends from web/node_modules like any other source file.
  resolve: { preserveSymlinks: true, alias: { "@dashboard": path.resolve(__dirname, "src") } },
  server: {
    port: 5173,
    // Extra host names the dev server may be reached by (a headless browser in Docker, say): "a,b".
    allowedHosts: (process.env.DASHBOARD_ALLOWED_HOSTS ?? "").split(",").filter(Boolean),
    proxy: {
      "/ws": { target: `ws://${process.env.DASHBOARD_SERVER ?? "127.0.0.1:4000"}`, ws: true },
      "/healthz": `http://${process.env.DASHBOARD_SERVER ?? "127.0.0.1:4000"}`,
      "/hooks": `http://${process.env.DASHBOARD_SERVER ?? "127.0.0.1:4000"}`,
    },
  },
});
