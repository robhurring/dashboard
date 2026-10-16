import type { ComponentType } from "react";

type ThemeModule = { default: ComponentType };
/** Every `web/themes/<name>/index.tsx`, loaded on demand. */
export const THEMES = import.meta.glob<ThemeModule>("../themes/*/index.tsx") as Record<string, () => Promise<ThemeModule>>;

export function themeNames(): string[] {
  return Object.keys(THEMES).map((p) => p.split("/").at(-2)!).sort();
}

/** `?theme=<name>` when it exists, else `wall`, else the first theme. Per-device selection comes later. */
export function pickTheme(search: string, available: string[]): string {
  const asked = new URLSearchParams(search).get("theme");
  if (asked && available.includes(asked)) return asked;
  return available.includes("wall") ? "wall" : [...available].sort()[0];
}

export function currentTheme(): string {
  return pickTheme(location.search, themeNames());
}

export function loadTheme(name: string): Promise<ThemeModule> {
  const key = Object.keys(THEMES).find((p) => p.endsWith(`/${name}/index.tsx`));
  if (!key) return Promise.reject(new Error(`no theme named ${name}`));
  return THEMES[key]();
}
