// Regenerates the README images from demo mode (?demo): one per page, then the banner.
// Run through bin/screenshots. Uses the installed Google Chrome; no browser download.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../../docs/images");
const port = Number(process.env.SCREENSHOT_PORT ?? 5199);
const base = `http://localhost:${port}/?demo`;
const pages = ["tasks", "glance", "news", "status"];

const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: path.resolve(here, ".."), stdio: "ignore" });
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(base)).ok) break; } catch { /* not up yet */ }
    if (i > 60) throw new Error(`vite did not start on port ${port}`);
    await sleep(250);
  }
  const browser = await chromium.launch({ channel: "chrome" });
  // The kiosk's panel is 1280x720; 2x keeps text crisp on retina screens.
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, colorScheme: "dark" });
  for (const id of pages) {
    const page = await context.newPage();
    await page.addInitScript((p) => localStorage.setItem("dashboard.page", p), id);
    await page.goto(base, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/${id}.png` });
    await page.close();
    console.log(`docs/images/${id}.png`);
  }
  const banner = await browser.newPage({ viewport: { width: 1280, height: 520 }, deviceScaleFactor: 2 });
  await banner.goto(`file://${out}/banner.html`, { waitUntil: "networkidle" });
  await banner.waitForTimeout(500);
  await banner.screenshot({ path: `${out}/banner.png` });
  console.log("docs/images/banner.png");
  await browser.close();
} finally {
  vite.kill();
}
