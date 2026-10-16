import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { CustomProps } from "@dashboard/components/registry";
import { Headlines } from "./index";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-16T14:00:00Z")); });
afterEach(() => vi.useRealTimers());

const state = {
  items: [
    { title: "Meta launches an open-weight AI model that runs on Macs", summary: "A 20B model tuned for Apple silicon.", url: "https://tc.example/meta", source: "TechCrunch", published_at: "2026-10-16T11:30:00Z" },
    { title: "Untitled source-less item", summary: "", url: null, source: null, published_at: null },
  ],
};
const props = (): CustomProps => ({ state: state as never, config: {}, status: null, send: vi.fn(), title: "AI news", density: "normal" });

describe("Headlines panel", () => {
  test("each item is a full title, a summary, and a source chip linking out with the age", () => {
    render(<Headlines {...props()} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Meta launches an open-weight AI model that runs on Macs")).toBeInTheDocument();
    expect(within(items[0]).getByText("A 20B model tuned for Apple silicon.")).toBeInTheDocument();
    const chip = within(items[0]).getByRole("link", { name: "TechCrunch" });
    expect(chip).toHaveAttribute("href", "https://tc.example/meta");
    expect(chip).toHaveAttribute("target", "_blank");
    expect(within(items[0]).getByText("2h ago")).toBeInTheDocument();
    // No url: the source is plain text; no source: nothing; no summary: nothing.
    expect(within(items[1]).queryByRole("link")).toBeNull();
    expect(within(items[1]).getByText("Untitled source-less item")).toBeInTheDocument();
  });

  test("empty feed says so; nothing before the first state", () => {
    const { container, rerender } = render(<Headlines {...props()} state={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<Headlines {...props()} state={{ items: [] } as never} />);
    expect(screen.getByText("No news")).toBeInTheDocument();
  });
});
