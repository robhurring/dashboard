import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WidgetTree } from "./WidgetTree";
import type { WidgetNode } from "../data/reduce";

const node = (type: string, props: WidgetNode["props"] = {}, children: WidgetNode[] = []): WidgetNode => ({ type, props, children });

describe("WidgetTree", () => {
  test("renders a stat", () => {
    render(<WidgetTree node={node("stat", { value: "58°", label: "Clouds", icon: "cloud-sun" })} send={vi.fn()} />);
    expect(screen.getByText("58°")).toBeInTheDocument();
    expect(screen.getByText("Clouds")).toBeInTheDocument();
  });

  test("renders an icon by its Lucide name", () => {
    const { container } = render(<WidgetTree node={node("icon", { name: "cloud-sun", size: 24 })} send={vi.fn()} />);
    expect(container.querySelector('[data-icon="cloud-sun"]')).not.toBeNull();
  });

  test("renders ticker items with direction", () => {
    render(<WidgetTree node={node("ticker", { items: [{ label: "AAPL", value: "231.40", delta: 0.82 }, { label: "NET", value: "118.07", delta: -1.35 }] })} send={vi.fn()} />);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("+0.82%")).toBeInTheDocument();
    expect(screen.getByText("-1.35%")).toBeInTheDocument();
  });

  test("a ticker item's change text, when given, is shown as-is and toned by delta", () => {
    render(<WidgetTree node={node("ticker", { items: [{ label: "CRM", value: "241.64", delta: -5.11, change: "-$5.11" }] })} send={vi.fn()} />);
    expect(screen.getByText("-$5.11")).toHaveClass("text-bad");
  });

  test("action props send commands", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    render(
      <WidgetTree
        node={node("list", { empty: "Nothing" }, [node("row", { title: "#incident", badge: 3, on_tap: { command: "dismiss", args: { name: "incident" } } })])}
        send={send}
      />,
    );
    fireEvent.click(screen.getByText("#incident"));
    expect(send).toHaveBeenCalledWith("dismiss", { name: "incident" });
  });

  test("empty lists show their empty text", () => {
    render(<WidgetTree node={node("list", { empty: "Slack is quiet" })} send={vi.fn()} />);
    expect(screen.getByText("Slack is quiet")).toBeInTheDocument();
  });

  test("unknown widgets render a placeholder instead of crashing", () => {
    render(<WidgetTree node={node("marquee")} send={vi.fn()} />);
    expect(screen.getByText(/marquee/)).toBeInTheDocument();
  });
});
