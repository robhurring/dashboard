import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Weather } from "./index";

// Nutley is UTC-4 in October; local times come from tz_offset, never the browser zone.
const state = {
  temp: 64, feels: 63, hi: 68, lo: 55, humidity: 41, wind: 9, sky: "Clear", description: "clear sky", icon: "sun", place: "Nutley",
  tz_offset: -14400, sunrise: 1792147200, sunset: 1792185600,
  forecast: [
    { at: 1792155600, temp: 60, icon: "sun", pop: 0 },
    { at: 1792166400, temp: 66, icon: "cloud-sun", pop: 10 },
    { at: 1792177200, temp: 59, icon: "cloud-rain", pop: 62 },
  ],
};

describe("Weather panel", () => {
  test("shows the temperature, conditions and details", () => {
    render(<Weather state={state} config={{ zip: "07110", units: "imperial" }} status={null} send={vi.fn()} title="Home" density="normal" />);
    expect(screen.getByText("64°")).toBeInTheDocument();
    expect(screen.getByText("clear sky")).toBeInTheDocument();
    expect(screen.getByText("63°")).toBeInTheDocument();
    expect(screen.getByText("68° / 55°")).toBeInTheDocument();
    expect(screen.getByText("41%")).toBeInTheDocument();
    expect(screen.getByText("9 mph")).toBeInTheDocument();
  });

  test("a forecast strip shows each slot's local time, icon, temperature and any real chance of rain", () => {
    render(<Weather state={state} config={{ units: "imperial" }} status={null} send={vi.fn()} title="Home" density="normal" />);
    const slots = screen.getAllByRole("listitem");
    expect(slots.map((s) => s.querySelector("[data-time]")?.textContent)).toEqual(["9 AM", "12 PM", "3 PM"]);
    expect(slots[0].querySelector('[data-icon="sun"]')).not.toBeNull();
    expect(slots[1]).toHaveTextContent("66°");
    expect(slots[2]).toHaveTextContent("62%");
    expect(slots[0]).not.toHaveTextContent("%"); // no rain: no percentage
    expect(screen.getByText("Sunrise")).toBeInTheDocument();
    expect(screen.getByText("6:40 AM")).toBeInTheDocument();
    expect(screen.getByText("5:20 PM")).toBeInTheDocument();
  });

  test("metric units label wind in km/h and renders nothing before the first state", () => {
    const { container } = render(<Weather state={null} config={{}} status={null} send={vi.fn()} title="" density="normal" />);
    expect(container).toBeEmptyDOMElement();
    render(<Weather state={{ ...state, wind: 14 }} config={{ units: "metric" }} status={null} send={vi.fn()} title="" density="normal" />);
    expect(screen.getByText("14 km/h")).toBeInTheDocument();
  });
});
