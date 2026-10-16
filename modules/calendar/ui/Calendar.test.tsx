import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { CustomProps } from "@dashboard/components/registry";
import { Calendar } from "./index";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 15, 12)); });
afterEach(() => vi.useRealTimers());

const state = {
  from: "2026-10-15",
  days: 3,
  events: [
    { title: "Trip", start: "2026-10-16", end: "2026-10-17", all_day: true, calendar: "Family" },
    { title: "Standup", start: "2026-10-15T09:00:00-04:00", end: "2026-10-15T09:30:00-04:00", all_day: false, calendar: "Work" },
    { title: "Dentist", start: "2026-10-17T15:30:00-04:00", end: "2026-10-17T16:00:00-04:00", all_day: false, calendar: "Family" },
    { title: "Late", start: "2026-10-16T20:00:00-04:00", end: "2026-10-16T21:00:00-04:00", all_day: false, calendar: "Work" },
  ],
};
const props = (): CustomProps => ({ state: state as unknown as CustomProps["state"], config: { days: 3 }, status: null, send: vi.fn(), title: "Calendar", density: "normal" });

describe("Calendar panel", () => {
  test("one column per day, named Today, Tomorrow, then the weekday, events in time order with all-day first", () => {
    render(<Calendar {...props()} />);
    const days = screen.getAllByRole("group");
    expect(days.map((d) => d.getAttribute("aria-label"))).toEqual(["Today", "Tomorrow", "Saturday"]);
    expect(within(days[0]).getByText("Standup")).toBeInTheDocument();
    const tomorrow = within(days[1]).getAllByRole("listitem").map((li) => li.textContent);
    expect(tomorrow[0]).toContain("Trip");
    expect(tomorrow[0]).toContain("all day");
    expect(tomorrow[1]).toContain("Late");
    expect(within(days[2]).getByText("Dentist")).toBeInTheDocument();
    // Times are the host zone's wall-clock times from the strings, whatever zone the browser runs in.
    expect(within(days[0]).getByText("9:00 AM – 9:30 AM")).toBeInTheDocument();
    expect(within(days[1]).getByText("8:00 PM – 9:00 PM")).toBeInTheDocument();
  });

  test("Today is the current date, even when the cached state was fetched yesterday", () => {
    vi.setSystemTime(new Date(2026, 9, 16, 8)); // the clock has passed midnight; state.from still says the 15th
    render(<Calendar {...props()} />);
    const days = screen.getAllByRole("group");
    expect(days.map((d) => d.getAttribute("aria-label"))).toEqual(["Today", "Tomorrow", "Sunday"]);
    expect(within(days[0]).getByText("Trip")).toBeInTheDocument(); // the 16th is now today
    expect(within(days[1]).getByText("Dentist")).toBeInTheDocument();
    expect(screen.queryByText("Standup")).toBeNull(); // yesterday's event is gone
  });

  test("past events are dimmed by default and hidden with past=hide; all-day events last the whole day", () => {
    vi.setSystemTime(new Date("2026-10-15T14:00:00-04:00")); // 2 PM New York: the 9 AM standup is over
    const { rerender } = render(<Calendar {...props()} />);
    const standup = screen.getByText("Standup").closest("li")!;
    expect(standup).toHaveAttribute("data-past", "true");
    expect(screen.getByText("Trip").closest("li")).toHaveAttribute("data-past", "false");
    rerender(<Calendar {...props()} config={{ days: 3, past: "hide" }} />);
    expect(screen.queryByText("Standup")).toBeNull();
    expect(screen.getByText("Trip")).toBeInTheDocument();
  });

  test("an empty day says so, and nothing renders before the first state", () => {
    const { container, rerender } = render(<Calendar {...props()} state={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<Calendar {...props()} state={{ ...state, events: [] } as never} />);
    expect(screen.getAllByText("Nothing planned")).toHaveLength(3);
  });
});
