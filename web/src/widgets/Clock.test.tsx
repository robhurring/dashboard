import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Clock, formatTime } from "./Clock";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Clock", () => {
  test("clock_widget_ticks_locally", () => {
    vi.setSystemTime(new Date("2026-10-15T14:05:00Z"));
    render(<Clock tz="America/New_York" label="New York" />);
    expect(screen.getByText("10:05")).toBeInTheDocument();
    expect(screen.getByText("New York")).toBeInTheDocument();
    act(() => { vi.setSystemTime(new Date("2026-10-15T14:06:00Z")); vi.advanceTimersByTime(1000); });
    expect(screen.getByText("10:06")).toBeInTheDocument();
  });

  test("falls back to local time for a bad zone and can show seconds", () => {
    vi.setSystemTime(new Date("2026-10-15T14:05:09Z"));
    render(<Clock tz="Nowhere/Nope" seconds />);
    expect(screen.getByText(/\d{1,2}:\d{2}:09/)).toBeInTheDocument();
  });

  test("format tokens cover 12/24 hour, padding, seconds, am/pm and dates", () => {
    const at = new Date("2026-10-05T14:05:09Z");
    const tz = "America/New_York";
    expect(formatTime(at, tz, "HH:mm")).toBe("10:05");
    expect(formatTime(at, tz, "H:mm:ss")).toBe("10:05:09");
    expect(formatTime(at, tz, "h:mm a")).toBe("10:05 am");
    expect(formatTime(at, tz, "hh:mm A")).toBe("10:05 AM");
    expect(formatTime(new Date("2026-10-05T21:05:09Z"), tz, "h:mm a")).toBe("5:05 pm");
    expect(formatTime(new Date("2026-10-06T04:05:09Z"), tz, "h:mm a")).toBe("12:05 am");
    expect(formatTime(at, tz, "ddd, MMM D")).toBe("Mon, Oct 5");
    expect(formatTime(at, tz, "dddd D MMMM YYYY")).toBe("Monday 5 October 2026");
    expect(formatTime(at, tz, "YYYY-MM-DD")).toBe("2026-10-05");
    expect(formatTime(at, "UTC", "HH:mm [UTC]")).toBe("14:05 UTC");
  });

  test("a format prop replaces the default time and a date prop adds a date line", () => {
    vi.setSystemTime(new Date("2026-10-05T21:05:09Z"));
    render(<Clock tz="America/New_York" format="h:mm a" date="dddd, MMMM D" />);
    expect(screen.getByText("5:05 pm")).toBeInTheDocument();
    expect(screen.getByText("Monday, October 5")).toBeInTheDocument();
  });

  test("date=true uses a default date format; seconds=true appends seconds to the default time", () => {
    vi.setSystemTime(new Date("2026-10-05T21:05:09Z"));
    render(<Clock tz="America/New_York" date seconds />);
    expect(screen.getByText("17:05:09")).toBeInTheDocument();
    expect(screen.getByText("Mon, Oct 5")).toBeInTheDocument();
  });

  test("analog style draws hands at the right angles and omits the second hand unless asked", () => {
    vi.setSystemTime(new Date("2026-10-05T19:30:15Z")); // 15:30:15 in New York
    const { rerender } = render(<Clock tz="America/New_York" style="analog" label="NY" />);
    const face = screen.getByRole("img", { name: /15:30/ });
    expect(face.querySelector('[data-hand="hour"]')).toHaveAttribute("transform", "rotate(105)");
    expect(face.querySelector('[data-hand="minute"]')).toHaveAttribute("transform", "rotate(180)");
    expect(face.querySelector('[data-hand="second"]')).toBeNull();
    expect(screen.getByText("NY")).toBeInTheDocument();
    rerender(<Clock tz="America/New_York" style="analog" seconds />);
    expect(screen.getByRole("img").querySelector('[data-hand="second"]')).toHaveAttribute("transform", "rotate(90)");
  });
});
