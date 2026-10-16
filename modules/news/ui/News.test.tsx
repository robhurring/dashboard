import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { CustomProps } from "@dashboard/components/registry";
import { News, parseDigest } from "./index";

const MD = `# Anthropic News Digest (Oct 15-16)

## Business & Valuation
- **IPO Expectations Adjusted**: Investors are tempering expectations, see [Reuters](https://r.example) and [FT](https://ft.example)
- **Credit Rating**: Anthropic secured the highest junk credit rating

## AI Safety & Ethics
- Plain bullet without a lead
Some closing paragraph.`;

const props = (markdown = MD): CustomProps => ({ state: { topic: "anthropic", markdown } as never, config: { topic: "anthropic" }, status: null, send: vi.fn(), title: "News · anthropic", density: "normal" });

describe("news digest", () => {
  test("parses the digest shape: title with range, sections, lead/body items, links", () => {
    const d = parseDigest(MD);
    expect(d.title).toBe("Anthropic News Digest");
    expect(d.range).toBe("Oct 15-16");
    expect(d.sections.map((s) => s.heading)).toEqual(["Business & Valuation", "AI Safety & Ethics"]);
    expect(d.sections[0].items[0]).toMatchObject({ lead: "IPO Expectations Adjusted", links: [{ label: "Reuters", href: "https://r.example" }, { label: "FT", href: "https://ft.example" }] });
    expect(d.sections[0].items[0].body).toBe("Investors are tempering expectations, see Reuters and FT");
    expect(d.sections[1].items[0]).toMatchObject({ lead: null, body: "Plain bullet without a lead" });
    expect(d.sections[1].items[1]).toMatchObject({ lead: null, body: "Some closing paragraph." });
  });

  test("renders sections, leads, bodies and link chips that open in a new tab", () => {
    render(<News {...props()} />);
    expect(screen.getByText("Oct 15-16")).toBeInTheDocument();
    expect(screen.queryByText("Anthropic News Digest")).toBeNull(); // the card title already says the topic
    const sections = screen.getAllByRole("group");
    expect(sections.map((s) => s.getAttribute("aria-label"))).toEqual(["Business & Valuation", "AI Safety & Ethics"]);
    const first = within(sections[0]).getAllByRole("listitem")[0];
    expect(within(first).getByText("IPO Expectations Adjusted")).toBeInTheDocument();
    const link = within(first).getByRole("link", { name: "Reuters" });
    expect(link).toHaveAttribute("href", "https://r.example");
    expect(link).toHaveAttribute("target", "_blank");
  });

  test("inline emphasis inside a body renders, and a bold run that is not a lead stays in the body", () => {
    render(<News {...props("## Export controls\n- Multiple outlets report that **Beijing is tightening** chip exports.\n- *Sources: Reuters, FT*")} />);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Beijing is tightening").tagName).toBe("STRONG");
    expect(within(items[1]).getByText("Sources: Reuters, FT").tagName).toBe("EM");
  });

  test("anything that is not a digest falls back to plain markdown", () => {
    render(<News {...props("Just a **sentence** with no structure.")} />);
    expect(screen.getByText("sentence").tagName).toBe("STRONG");
    expect(screen.queryByRole("group")).toBeNull();
  });

  test("renders nothing before the first state", () => {
    const { container } = render(<News {...props()} state={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
