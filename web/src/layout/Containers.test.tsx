import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Flow, Tile, flowHeight, flowRows } from "./Containers";
import { Slot } from "./Slot";

describe("Flow", () => {
  test("is a grid of equal columns at least `width` wide, on rows of `unit`, packing gaps", () => {
    render(
      <Flow width={20} unit={10} gap={6}>
        <section>one</section>
        <section>two</section>
      </Flow>,
    );
    const items = screen.getAllByText(/one|two/).map((el) => el.parentElement!);
    const flow = items[0].parentElement!;
    expect(items).toHaveLength(2);
    expect(flow.style.display).toBe("grid");
    expect(flow.style.gridTemplateColumns).toBe("repeat(auto-fill, minmax(min(100%, 20rem), 1fr))");
    expect(flow.style.gridAutoRows).toBe("10rem");
    expect(flow.style.gap).toBe("1.5rem");
    expect(flow.style.gridAutoFlow).toBe("row dense");
  });

  test("an item spans as many rows as its content needs, so two short items stack beside one tall one", () => {
    // 160px rows with 24px gaps: one row is 160, two are 344.
    expect(flowRows(100, 160, 24)).toBe(1);
    expect(flowRows(160, 160, 24)).toBe(1);
    expect(flowRows(161, 160, 24)).toBe(2);
    expect(flowRows(344, 160, 24)).toBe(2);
    expect(flowRows(0, 160, 24)).toBe(1);
    expect(flowHeight(2, 10, 6)).toBe("21.5rem");
  });

  test("tiles take Apple-widget sizes (small 1x1, medium 2x1, large 2x2) or any columns and rows", () => {
    render(
      <Flow>
        <Tile size="small"><p>small</p></Tile>
        <Tile size="medium"><p>medium</p></Tile>
        <Tile size="large"><p>large</p></Tile>
        <Tile cols={1} rows={3}><p>custom</p></Tile>
      </Flow>,
    );
    const span = (text: string) => {
      const el = screen.getByText(text).parentElement!;
      return [el.style.gridColumn, el.style.gridRow];
    };
    expect(span("small")).toEqual(["span 1", "span 1"]);
    expect(span("medium")).toEqual(["span 2", "span 1"]);
    expect(span("large")).toEqual(["span 2", "span 2"]);
    expect(span("custom")).toEqual(["span 1", "span 3"]);
    expect(screen.getByText("custom").parentElement!.style.height).toBe(flowHeight(3));
  });

  test("a slot in a flow sizes to its module's content, so its tile can measure it", () => {
    const { container } = render(<Flow><Slot module="clock" instance="flow" /></Flow>);
    const slot = container.querySelector<HTMLElement>("[data-slot]")!;
    expect(slot.style.flex).toBe("1 0 auto");
  });
});
