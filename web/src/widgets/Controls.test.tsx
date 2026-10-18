import { describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { WidgetTree } from "./WidgetTree";

const cmd = (command: string, args: Record<string, unknown> = {}) => ({ command, args });
const draw = (type: string, props: Record<string, unknown>, send = vi.fn().mockResolvedValue(undefined)) => {
  const utils = render(<WidgetTree node={{ type, props, children: [] } as never} send={send} />);
  return { send, ...utils };
};

describe("ui.button", () => {
  test("runs its command when tapped", () => {
    const { send } = draw("button", { label: "Refresh", icon: "zap", on_tap: cmd("refresh") });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(send).toHaveBeenCalledWith("refresh", {});
  });

  test("shows the command's error when it fails", async () => {
    draw("button", { label: "Run", on_tap: cmd("run") }, vi.fn().mockRejectedValue(new Error("scene not found")));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Run" })); });
    expect(await screen.findByRole("alert")).toHaveTextContent("scene not found");
  });
});

describe("ui.toggle", () => {
  test("flips at once and sends the new value with the command's args", () => {
    const { send } = draw("toggle", { label: "Kitchen", on: false, on_change: cmd("set_light", { id: "kitchen" }) });
    const sw = screen.getByRole("switch", { name: "Kitchen" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(send).toHaveBeenCalledWith("set_light", { id: "kitchen", value: true });
  });

  test("flips back and says why when the command fails", async () => {
    draw("toggle", { label: "Kitchen", on: false, on_change: cmd("set_light") }, vi.fn().mockRejectedValue(new Error("light offline")));
    await act(async () => { fireEvent.click(screen.getByRole("switch", { name: "Kitchen" })); });
    expect(screen.getByRole("switch", { name: "Kitchen" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("alert")).toHaveTextContent("light offline");
  });

  test("follows the module's state when it changes", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { rerender } = draw("toggle", { label: "Zone 1", on: false, on_change: cmd("zone") }, send);
    rerender(<WidgetTree node={{ type: "toggle", props: { label: "Zone 1", on: true, on_change: cmd("zone") }, children: [] } as never} send={send} />);
    expect(screen.getByRole("switch", { name: "Zone 1" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("ui.toggle styles and icons", () => {
  test("an icon beside the label, with an optional off icon", () => {
    const { container } = draw("toggle", { label: "Lamp", icon: "lightbulb", icon_off: "lightbulb-off", on: false, on_change: cmd("lamp") });
    expect(container.querySelector('[data-icon="lightbulb-off"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Lamp" }));
    expect(container.querySelector('[data-icon="lightbulb"]')).not.toBeNull();
  });

  test("slide: a big pill to slide on and off, horizontal or upright like a wall switch", () => {
    const { send } = draw("toggle", { label: "Porch", style: "slide", orientation: "vertical", icon: "lightbulb", on: true, on_change: cmd("porch") });
    const sw = screen.getByRole("switch", { name: "Porch" });
    expect(sw).toHaveAttribute("data-style", "slide");
    expect(sw).toHaveAttribute("data-orientation", "vertical");
    fireEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(send).toHaveBeenCalledWith("porch", { value: false });
  });

  test("tile: a Control Center square that lights up when on", () => {
    draw("toggle", { label: "Fan", style: "tile", icon: "fan", on: true, on_change: cmd("fan") });
    const sw = screen.getByRole("switch", { name: "Fan" });
    expect(sw).toHaveAttribute("data-style", "tile");
    expect(sw).toHaveAttribute("aria-checked", "true");
  });
});

describe("ui.slider", () => {
  const track = (el: HTMLElement, rect: Partial<DOMRect>) => {
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}), ...rect });
  };

  test("keys move it a step at a time, and it sends once the key is let go", () => {
    const { send } = draw("slider", { label: "Brightness", min: 0, max: 100, step: 5, value: 40, unit: "%", on_change: cmd("dim", { id: "kitchen" }) });
    const slider = screen.getByRole("slider", { name: "Brightness" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(send).toHaveBeenCalledWith("dim", { id: "kitchen", value: 50 });
  });

  test("dragging sets the value by position; vertical fills from the bottom", () => {
    const { send } = draw("slider", { label: "Volume", min: 0, max: 100, step: 1, value: 10, orientation: "vertical", on_change: cmd("volume") });
    const slider = screen.getByRole("slider", { name: "Volume" });
    track(slider, {});
    fireEvent.pointerDown(slider, { clientX: 100, clientY: 50, pointerId: 1 });
    expect(slider).toHaveAttribute("aria-valuenow", "75");
    fireEvent.pointerUp(slider, { clientX: 100, clientY: 50, pointerId: 1 });
    expect(send).toHaveBeenCalledWith("volume", { value: 75 });
  });

  test("horizontal fills from the left", () => {
    const { send } = draw("slider", { label: "Fan speed", min: 0, max: 10, step: 1, value: 0, on_change: cmd("speed") });
    const slider = screen.getByRole("slider", { name: "Fan speed" });
    track(slider, {});
    fireEvent.pointerDown(slider, { clientX: 60, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: 60, clientY: 10, pointerId: 1 });
    expect(send).toHaveBeenCalledWith("speed", { value: 3 });
  });
});

describe("ui.choice", () => {
  test("marks the current option and sends the one picked", () => {
    const { send } = draw("choice", { label: "Scene", value: "day", options: ["day", { value: "movie", label: "Movie night" }, "off"], on_change: cmd("scene") });
    expect(screen.getByRole("radio", { name: "day" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Movie night" }));
    expect(screen.getByRole("radio", { name: "Movie night" })).toHaveAttribute("aria-checked", "true");
    expect(send).toHaveBeenCalledWith("scene", { value: "movie" });
  });
});
