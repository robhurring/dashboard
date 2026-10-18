import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WidgetTree } from "./WidgetTree";
import { Title } from "../layout";

const title = (props: Record<string, unknown>) => render(<WidgetTree node={{ type: "title", props, children: [] } as never} send={vi.fn()} />);

describe("ui.title", () => {
  test("a heading with details below, left-aligned, and no panel or background", () => {
    const { container } = title({ text: "Charts", sub: "2 of 9" });
    expect(screen.getByRole("heading", { name: "Charts" })).toBeInTheDocument();
    expect(screen.getByText("2 of 9")).toBeInTheDocument();
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.align).toBe("left");
    expect(root.dataset.details).toBe("below");
    expect(root.className).not.toMatch(/\bbg-/);
  });

  test("center and right alignment; details beside the title when asked, except when centered", () => {
    const { container, rerender } = title({ text: "Status", sub: "all good", align: "right", details: "beside" });
    let root = container.firstElementChild as HTMLElement;
    expect(root.dataset.align).toBe("right");
    expect(root.dataset.details).toBe("beside");
    rerender(<WidgetTree node={{ type: "title", props: { text: "Status", sub: "all good", align: "center", details: "beside" }, children: [] } as never} send={vi.fn()} />);
    root = container.firstElementChild as HTMLElement;
    expect(root.dataset.align).toBe("center");
    expect(root.dataset.details).toBe("below");
  });

  test("an icon, and the same component for themes", () => {
    const { container } = render(<Title text="Garden" icon="sprout" sub="3 zones" />);
    expect(screen.getByRole("heading", { name: "Garden" })).toBeInTheDocument();
    expect(container.querySelector('[data-icon="sprout"]')).not.toBeNull();
  });
});
