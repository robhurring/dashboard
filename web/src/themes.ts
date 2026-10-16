import type { ComponentType } from "react";
import { themes } from "virtual:dashboard/extensions";

type ThemeModule = { default: ComponentType };
/** Every theme across the THEMES_DIR folders (web/themes, then local/themes by default), loaded on demand. */
export const THEMES = themes as Record<string, () => Promise<ThemeModule>>;

export function themeNames(): string[] {
  return Object.keys(THEMES).sort();
}

/**
 * The theme to open without `?theme`: DEFAULT_THEME from the server (a meta tag it fills in when it
 * serves the page), else DEFAULT_THEME at build time (development), else "home".
 */
declare const __DEFAULT_THEME__: string;
export function defaultTheme(doc: Document = document): string {
  const runtime = doc.querySelector<HTMLMetaElement>('meta[name="dashboard-default-theme"]')?.content;
  if (runtime) return runtime;
  return typeof __DEFAULT_THEME__ === "string" && __DEFAULT_THEME__ ? __DEFAULT_THEME__ : "home";
}

/** `?theme=<name>` when it exists, else the default theme, else "home", else the first theme. */
export function pickTheme(search: string, available: string[], fallback = defaultTheme()): string {
  const asked = new URLSearchParams(search).get("theme");
  if (asked && available.includes(asked)) return asked;
  if (available.includes(fallback)) return fallback;
  return available.includes("home") ? "home" : [...available].sort()[0];
}

export function currentTheme(): string {
  return pickTheme(location.search, themeNames());
}

export function loadTheme(name: string): Promise<ThemeModule> {
  const load = THEMES[name];
  if (!load) return Promise.reject(new Error(`no theme named ${name}`));
  return load();
}
