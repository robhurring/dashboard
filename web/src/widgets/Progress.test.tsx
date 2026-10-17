import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WidgetTree } from "./WidgetTree";

const progress = (props: Record<string, unknown>) => render(<WidgetTree node={{ type: "progress", props, children: [] } as never} send={vi.fn()} />);
const DEPLETION = { "0": "red", "10": "yellow", "25": "green" };

describe("ui.progress", () => {
  test("a horizontal bar filled to value out of max, with its label and text", () => {
    progress({ value: 7.5, max: 10, label: "Balance", text: "$7.50 left of $10.00" });
    const bar = screen.getByRole("progressbar", { name: "Balance" });
    expect(bar).toHaveAttribute("aria-valuenow", "75");
    expect(screen.getByText("$7.50 left of $10.00")).toBeInTheDocument();
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("75%");
  });

  test("stops color it by how full it is: green when plenty is left, yellow when low, red when nearly empty", () => {
    const fill = (value: number) => {
      const { unmount } = progress({ value, max: 10, label: "Balance", stops: DEPLETION });
      const color = (screen.getByRole("progressbar").firstElementChild as HTMLElement).style.background;
      unmount();
      return color;
    };
    expect(fill(9.96)).toContain("good");
    expect(fill(2)).toContain("warn");
    expect(fill(0.5)).toContain("bad");
  });

  test("values outside 0..max are clamped", () => {
    progress({ value: 14, max: 10, label: "Over" });
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
});
