import { describe, expect, test } from "vitest";
import { pickTheme } from "./themes";

describe("pickTheme", () => {
  test("url parameter wins when the theme exists", () => expect(pickTheme("?theme=wall", ["wall", "other"])).toBe("wall"));
  test("unknown url theme falls back to wall", () => expect(pickTheme("?theme=nope", ["wall", "other"])).toBe("wall"));
  test("without wall, the first theme is used", () => expect(pickTheme("", ["zed", "alpha"])).toBe("alpha"));
});
