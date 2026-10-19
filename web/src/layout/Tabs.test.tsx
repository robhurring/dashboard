import { beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Tab, Tabs } from "./Tabs";

beforeEach(() => localStorage.clear());

const news = (props = {}) => (
  <Tabs id="news" {...props}>
    <Tab title="AI"><p>ai digest</p></Tab>
    <Tab title="OpenAI"><p>openai digest</p></Tab>
  </Tabs>
);

describe("Tabs", () => {
  test("a segmented control picks which tab shows; the others stay mounted, hidden", () => {
    render(news());
    const ai = screen.getByRole("tab", { name: "AI" });
    const openai = screen.getByRole("tab", { name: "OpenAI" });
    expect(ai).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("ai digest").closest("[role=tabpanel]")).not.toHaveAttribute("hidden");
    expect(screen.getByText("openai digest").closest("[role=tabpanel]")).toHaveAttribute("hidden");
    fireEvent.click(openai);
    expect(openai).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("ai digest").closest("[role=tabpanel]")).toHaveAttribute("hidden");
    expect(screen.getByText("openai digest").closest("[role=tabpanel]")).not.toHaveAttribute("hidden");
  });

  test("remembers the chosen tab across a reload", () => {
    const { unmount } = render(news());
    fireEvent.click(screen.getByRole("tab", { name: "OpenAI" }));
    unmount();
    render(news());
    expect(screen.getByRole("tab", { name: "OpenAI" })).toHaveAttribute("aria-selected", "true");
  });

  test("taps on the control don't start a page swipe", () => {
    render(news());
    expect(screen.getByRole("tablist").closest("[data-swipe=off]")).not.toBeNull();
  });
});
