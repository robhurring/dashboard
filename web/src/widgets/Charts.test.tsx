import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WidgetTree } from "./WidgetTree";
import type { WidgetNode } from "../data/reduce";
import { gaugeColor, palette } from "./Charts";

const node = (type: string, props: WidgetNode["props"] = {}): WidgetNode => ({ type, props, children: [] });

describe("chart widgets", () => {
  test("gauge shows the value, unit, label and sub as text", () => {
    render(<WidgetTree node={node("gauge", { value: 42.4, max: 100, unit: "%", label: "CPU", sub: "4 cores" })} send={vi.fn()} />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("%")).toBeInTheDocument();
    expect(screen.getByText("CPU")).toBeInTheDocument();
    expect(screen.getByText("4 cores")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "CPU" })).toHaveAttribute("aria-valuenow", "42.4");
  });

  test("gauge shows an icon beside its label, including the custom redis mark", () => {
    render(<WidgetTree node={node("gauge", { value: 5, label: "Memory", icon: "redis" })} send={vi.fn()} />);
    expect(document.querySelector('[data-icon="redis"]')).not.toBeNull();
    render(<WidgetTree node={node("gauge", { value: 5, label: "CPU", icon: "cpu" })} send={vi.fn()} />);
    expect(document.querySelector('[data-icon="cpu"]')).not.toBeNull();
  });

  test("gauge color: accent with no stops, green below the stops, and the stop's color at a breakpoint; tone overrides the base", () => {
    expect(gaugeColor(10, {})).toBe("var(--color-accent)");
    expect(gaugeColor(50, { stops: { "75": "yellow", "90": "red" } })).toBe("var(--color-good)");
    expect(gaugeColor(50, { stops: { "75": "yellow", "90": "red" }, tone: "purple" })).toBe("var(--color-accent)");
    expect(gaugeColor(75, { stops: { "75": "yellow", "90": "red" } })).toBe("var(--color-warn)");
    expect(gaugeColor(95, { stops: { "90": "red", "75": "yellow" } })).toBe("var(--color-bad)");
    expect(gaugeColor(96, { stops: { "95": "#ff00ff" } })).toBe("#ff00ff");
    expect(gaugeColor(20, { tone: "good" })).toBe("var(--color-good)");
    // warn_at / bad_at are shorthand for two stops
    expect(gaugeColor(72, { warn_at: 70, bad_at: 90 })).toBe("var(--color-warn)");
    expect(gaugeColor(50, { warn_at: 70, bad_at: 90 })).toBe("var(--color-good)");
  });

  test("line renders its label and the last value", () => {
    render(<WidgetTree node={node("line", { points: [1, 5, 3.25], label: "CPU · 30m", unit: "%" })} send={vi.fn()} />);
    expect(screen.getByText("CPU · 30m")).toBeInTheDocument();
    expect(screen.getByText("3.25")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "CPU · 30m" })).toBeInTheDocument();
  });

  const items = [{ label: "web", value: 12 }, { label: "jobs", value: 30 }];

  test("bar lists its items with values", () => {
    render(<WidgetTree node={node("bar", { items, label: "Requests" })} send={vi.fn()} />);
    expect(screen.getByText("Requests")).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  test("donut lists its items and shows the center figure", () => {
    render(<WidgetTree node={node("donut", { items, center: "42" })} send={vi.fn()} />);
    expect(screen.getByText("jobs")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  test("the series palette cycles through theme tokens", () => {
    expect(palette(0)).toBe("var(--color-accent)");
    expect(palette(1)).toBe("var(--color-paper-sky)");
    expect(palette(6)).toBe(palette(0));
  });
});

test("items may repeat a label (two Tuesdays) without React key collisions", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  render(<WidgetTree node={{ type: "group", props: {}, children: [
    { type: "bar", props: { items: [{ label: "T", value: 1 }, { label: "T", value: 2 }] }, children: [] },
    { type: "donut", props: { items: [{ label: "x", value: 1 }, { label: "x", value: 2 }] }, children: [] },
    { type: "ticker", props: { items: [{ label: "A", value: "1" }, { label: "A", value: "2" }] }, children: [] },
  ] } as never} send={vi.fn()} />);
  expect(error.mock.calls.filter((c) => String(c[0]).includes("same key"))).toEqual([]);
  error.mockRestore();
});

test("a line with one point draws flat across instead of a lone dot", async () => {
  const { lineData } = await import("./Charts");
  expect(lineData([42])).toEqual([{ i: 0, v: 42 }, { i: 1, v: 42 }]);
  expect(lineData([1, 2])).toEqual([{ i: 0, v: 1 }, { i: 1, v: 2 }]);
  expect(lineData([])).toEqual([]);
});
