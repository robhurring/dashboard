import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WidgetTree } from "./WidgetTree";

const md = (props: Record<string, unknown>) => render(<WidgetTree node={{ type: "markdown", props, children: [] } as never} send={vi.fn()} />);

const SAMPLE = `# Release 1.8

Shipped **today** with _care_ and ~~drama~~. See [the notes](https://example.com/notes) or https://example.com.

## Checklist

- [x] migrate
- [ ] announce

| Service | Status |
|---|---|
| api | up |

\`\`\`sh
bin/deploy prod
\`\`\`

> Quoted.

![chart](https://example.com/chart.png)
`;

describe("ui.markdown", () => {
  test("renders full markdown: headings, emphasis, links, task lists, tables, code blocks, quotes, images", () => {
    const { container } = md({ text: SAMPLE });
    expect(screen.getByRole("heading", { level: 1, name: "Release 1.8" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Checklist" })).toBeInTheDocument();
    expect(container.querySelector("strong")?.textContent).toBe("today");
    expect(container.querySelector("del")?.textContent).toBe("drama");
    const link = screen.getByRole("link", { name: "the notes" });
    expect(link).toHaveAttribute("href", "https://example.com/notes");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "https://example.com" })).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(screen.getByRole("table")).toHaveTextContent("api");
    expect(container.querySelector("pre code")?.textContent).toContain("bin/deploy prod");
    expect(container.querySelector("blockquote")).toHaveTextContent("Quoted.");
    expect(screen.getByRole("img", { name: "chart" })).toHaveAttribute("src", "https://example.com/chart.png");
  });

  test("links = false renders links as plain text, for kiosks that must never navigate", () => {
    md({ text: "See [the notes](https://example.com/notes).", links: false });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("the notes")).toBeInTheDocument();
  });

  test("raw HTML is never rendered", () => {
    const { container } = md({ text: 'Hi <script>alert(1)</script><b onclick="x()">bold</b>' });
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });
});
