import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { preserveSymlinks: true, alias: { "@dashboard": path.resolve(__dirname, "src") } },
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], include: ["src/**/*.test.{ts,tsx}", "modules/*/ui/**/*.test.{ts,tsx}"] },
});
