import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WidgetTree } from "./WidgetTree";
import type { WidgetNode } from "../data/reduce";

const node = (type: string, props: WidgetNode["props"] = {}): WidgetNode => ({ type, props, children: [] });

describe("text and badge widgets", () => {
  test("text renders restricted markdown: headings, lists, emphasis; links open in a new tab; html is dropped", () => {
    render(<WidgetTree node={node("text", { text: "## Anthropic\n\n- Claude **ships** [today](https://x)\n- <script>alert(1)</script>second" })} send={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Anthropic" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("ships").tagName).toBe("STRONG");
    const link = screen.getByRole("link", { name: "today" });
    expect(link).toHaveAttribute("href", "https://x");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(document.querySelector("script")).toBeNull();
  });

  test("badge shows its text with a tone", () => {
    render(<WidgetTree node={node("badge", { text: 3, tone: "bad" })} send={vi.fn()} />);
    const badge = screen.getByText("3");
    expect(badge).toHaveAttribute("data-tone", "bad");
  });
});
