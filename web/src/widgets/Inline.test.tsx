import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { Inline } from "./Inline";

const html = (text: string) => render(<span><Inline text={text} /></span>).container.firstElementChild!.innerHTML;

describe("Inline: light markdown for one-line labels", () => {
  test("bold, italic, underline, strike and code", () => {
    expect(html("**3** new")).toBe('<strong class="font-semibold">3</strong> new');
    expect(html("*soon* and _later_")).toBe("<em>soon</em> and <em>later</em>");
    expect(html("__room 4__")).toBe('<u class="underline-offset-2">room 4</u>');
    expect(html("~~old~~ new")).toBe('<del>old</del> new');
    expect(html("on `main`")).toBe('on <code class="rounded bg-ink/10 px-[0.25em] font-mono text-[0.9em]">main</code>');
  });

  test("plain text stays plain; unmatched markers stay as typed; nothing becomes HTML", () => {
    expect(html("Unread")).toBe("Unread");
    expect(html("a * b and 2*3")).toBe("a * b and 2*3");
    expect(html("**open")).toBe("**open");
    expect(html("<b>x</b>")).toBe("&lt;b&gt;x&lt;/b&gt;");
    expect(html("snake_case_name")).toBe("snake_case_name");
  });

  test("no nesting surprises: code is literal", () => {
    expect(html("`**not bold**`")).toContain("**not bold**");
  });
});
