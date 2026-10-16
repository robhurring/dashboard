import { describe, expect, test } from "vitest";
import { interpolate } from "./template";

describe("interpolate", () => {
  const data = { config: { zip: "07110", label: "Home" }, state: { feels: 61, sky: "Clouds" }, status: { ok: true } };
  test("resolves dotted paths", () => {
    expect(interpolate("Weather: {{config.label}} ({{config.zip}}) - feels {{state.feels}}°", data)).toBe("Weather: Home (07110) - feels 61°");
  });
  test("missing paths render empty and odd braces stay put", () => {
    expect(interpolate("{{state.nope}}|{{ unclosed", data)).toBe("|{{ unclosed");
  });
  test("objects and booleans render sensibly", () => {
    expect(interpolate("{{status.ok}} {{state}}", data)).toBe("true [object]");
  });
});
