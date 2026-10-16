declare module "virtual:dashboard/extensions" {
  type Loader = () => Promise<Record<string, unknown>>;
  /** Module name -> its ui/index.tsx, from the MODULES_DIR folders (later folders win). */
  export const moduleUis: Record<string, Loader>;
  /** Theme name -> its index.tsx, from the THEMES_DIR folders. */
  export const themes: Record<string, Loader>;
  /** Widget name (ui.<name>) -> its file, from the WIDGETS_DIR folders. */
  export const widgets: Record<string, Loader>;
}
