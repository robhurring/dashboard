import { describe, expect, test } from "vitest";
import { defaultTheme, pickTheme } from "./themes";

describe("pickTheme", () => {
  test("url parameter wins when the theme exists", () => expect(pickTheme("?theme=gallery", ["home", "gallery"], "home")).toBe("gallery"));
  test("an unknown url theme falls back to the default", () => expect(pickTheme("?theme=nope", ["home", "wall"], "wall")).toBe("wall"));
  test("the default theme opens without a url parameter", () => expect(pickTheme("", ["home", "wall"], "wall")).toBe("wall"));
  test("a default that does not exist falls back to home, then the first theme", () => {
    expect(pickTheme("", ["gallery", "home"], "missing")).toBe("home");
    expect(pickTheme("", ["zed", "alpha"], "missing")).toBe("alpha");
  });

  test("the server's meta tag sets the default theme", () => {
    const doc = document.implementation.createHTMLDocument();
    expect(defaultTheme(doc)).toBe("home");
    doc.head.innerHTML = '<meta name="dashboard-default-theme" content="wall">';
    expect(defaultTheme(doc)).toBe("wall");
  });
});
