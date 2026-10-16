/** Handlebars-style `{{a.b}}` substitution with dotted paths. No logic, no escaping (React escapes on render). */
export function interpolate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, path: string) => {
    let cur: unknown = data;
    for (const key of path.split(".")) {
      if (cur === null || typeof cur !== "object" || !(key in (cur as object))) return "";
      cur = (cur as Record<string, unknown>)[key];
    }
    if (cur === null || cur === undefined) return "";
    if (typeof cur === "object") return "[object]";
    return String(cur);
  });
}
