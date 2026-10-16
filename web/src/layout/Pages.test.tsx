import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Page, Pages, Slot } from "./index";
import { currentDeclarations } from "../data/slots";
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => vi.useRealTimers());

const three = (extra = {}) => (
  <Pages home="a" {...extra}>
    <Page id="a" title="Tasks">A!</Page>
    <Page id="b" title="Glance">B!</Page>
    <Page id="c" title="Status">C!</Page>
  </Pages>
);

const pageOf = (text: string) => screen.getByText(text).closest("[data-page]")!;
const track = () => screen.getByTestId("pages-track");
const dots = () => screen.getByRole("tablist", { name: "Pages" });
const expectPage = (text: string, index: number) => {
  expect(pageOf(text)).not.toHaveAttribute("aria-hidden", "true");
  expect(track().style.transform).toBe(`translateX(${-index * 100}%)`);
};
const settle = () => act(() => vi.advanceTimersByTime(1500));

/** A horizontal drag from x1 to x2 on the swipe surface. */
function swipe(x1: number, x2: number, pointerType = "touch", target: Element = track()) {
  fireEvent.pointerDown(target, { pointerId: 1, clientX: x1, clientY: 100, pointerType, isPrimary: true });
  fireEvent.pointerMove(target, { pointerId: 1, clientX: x1 + Math.sign(x2 - x1) * 12, clientY: 101, pointerType });
  fireEvent.pointerMove(target, { pointerId: 1, clientX: x2, clientY: 102, pointerType });
  fireEvent.pointerUp(target, { pointerId: 1, clientX: x2, clientY: 102, pointerType });
}

function wheelRun(deltas: number[], target: Element = track()) {
  for (const d of deltas) { fireEvent.wheel(target, { deltaX: d, deltaY: 0 }); act(() => vi.advanceTimersByTime(16)); }
}

describe("Pages", () => {
  test("shows the home page, keeps the others mounted but inert, with a dot per page", () => {
    render(three());
    expectPage("A!", 0);
    expect(pageOf("B!")).toHaveAttribute("aria-hidden", "true");
    expect(pageOf("B!")).toHaveAttribute("inert");
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((d) => d.getAttribute("aria-label"))).toEqual(["Tasks", "Glance", "Status"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "Glance" })).toBeNull();
  });

  test("tapping a dot goes to that page", () => {
    render(three());
    fireEvent.click(screen.getByRole("tab", { name: "Status" }));
    expectPage("C!", 2);
  });

  test("the track is always on a whole page: a swipe moves exactly one page the moment its direction is clear", () => {
    render(three());
    const t = track();
    fireEvent.pointerDown(t, { pointerId: 1, clientX: 600, clientY: 100, pointerType: "touch", isPrimary: true });
    fireEvent.pointerMove(t, { pointerId: 1, clientX: 585, clientY: 101, pointerType: "touch" });
    expectPage("A!", 0); // direction not yet clear
    fireEvent.pointerMove(t, { pointerId: 1, clientX: 530, clientY: 102, pointerType: "touch" });
    expectPage("B!", 1); // committed mid-drag, straight to a whole page
    fireEvent.pointerMove(t, { pointerId: 1, clientX: 100, clientY: 102, pointerType: "touch" });
    fireEvent.pointerUp(t, { pointerId: 1, clientX: 100, clientY: 102, pointerType: "touch" });
    expectPage("B!", 1); // the rest of that drag is spent, however far it goes
    settle();
    swipe(300, 600);
    expectPage("A!", 0);
    settle();
    swipe(300, 600);
    expectPage("A!", 0); // first page: nothing to go back to
  });

  test("a tiny drag does nothing, and mostly vertical movement is not a swipe", () => {
    render(three());
    const t = track();
    swipe(600, 570);
    expectPage("A!", 0);
    fireEvent.pointerDown(t, { pointerId: 1, clientX: 600, clientY: 100, pointerType: "touch", isPrimary: true });
    fireEvent.pointerMove(t, { pointerId: 1, clientX: 596, clientY: 140, pointerType: "touch" });
    fireEvent.pointerMove(t, { pointerId: 1, clientX: 400, clientY: 400, pointerType: "touch" });
    fireEvent.pointerUp(t, { pointerId: 1, clientX: 400, clientY: 400, pointerType: "touch" });
    expectPage("A!", 0);
  });

  test("a release outside the track or losing the window ends the drag cleanly", () => {
    render(three());
    const t = track();
    fireEvent.pointerDown(t, { pointerId: 1, clientX: 600, clientY: 100, pointerType: "mouse", isPrimary: true });
    fireEvent.pointerMove(t, { pointerId: 1, clientX: 580, clientY: 101, pointerType: "mouse" });
    fireEvent.pointerMove(t, { pointerId: 1, clientX: 200, clientY: 102, pointerType: "mouse" });
    expectPage("B!", 1);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 200, clientY: 102, pointerType: "mouse" });
    settle();
    fireEvent.pointerDown(t, { pointerId: 2, clientX: 600, clientY: 100, pointerType: "mouse", isPrimary: true });
    fireEvent.blur(window);
    swipe(600, 300);
    expectPage("C!", 2); // the blurred drag did not wedge the next one
  });

  test("regions can opt out: data-swipe=off never swipes, data-swipe=touch swipes only by touch", () => {
    render(
      <Pages home="a">
        <Page id="a" title="Tasks"><div data-swipe="off">locked</div><div data-swipe="touch">note</div></Page>
        <Page id="b" title="Glance">B!</Page>
      </Pages>,
    );
    swipe(600, 300, "touch", screen.getByText("locked"));
    expect(pageOf("locked")).not.toHaveAttribute("aria-hidden", "true");
    swipe(600, 300, "mouse", screen.getByText("note"));
    expect(pageOf("locked")).not.toHaveAttribute("aria-hidden", "true");
    swipe(600, 300, "touch", screen.getByText("note"));
    expect(pageOf("B!")).not.toHaveAttribute("aria-hidden", "true");
  });

  test("a two-finger trackpad swipe moves exactly one page, whatever its length or momentum tail", () => {
    render(three());
    // A hard swipe: big deltas, then a long decaying tail with sign jitter. One page.
    wheelRun([80, 120, 120, 100, 60, 40, 20, 15, -2, 12, 9, -1, 8, 5, 3, 2, 1, 1]);
    expectPage("B!", 1);
    // Tail-sized bumps and sign jitter are neither a new push nor a reversal.
    wheelRun([8, -2, 6, -1, 5, 3, 2]);
    expectPage("B!", 1);
    // A fresh push the same way, once the tail has died down, counts at once.
    wheelRun([40, 40, 40, 40, 40]);
    expectPage("C!", 2);
    // Inside that swipe's tail, a real swipe back works at once, no quiet gap needed.
    wheelRun(Array(24).fill(3)); // ~380 ms of tail, never quiet
    wheelRun([4, 3, -30, -40, -30, -10, -5]);
    expectPage("B!", 1);
    settle();
    wheelRun([-80, -120, -60]);
    expectPage("A!", 0);
    settle();
    wheelRun([80, 120, 60]);
    expectPage("B!", 1);
    settle();
    // Quiet, then a short soft swipe is enough for one page.
    wheelRun([20, 25, 20]);
    expectPage("C!", 2);
    settle();
    // Vertical scrolling never swipes; a tiny horizontal nudge does nothing.
    for (let i = 0; i < 6; i++) { fireEvent.wheel(track(), { deltaX: 2, deltaY: 40 }); act(() => vi.advanceTimersByTime(16)); }
    wheelRun([-15]);
    expectPage("C!", 2);
    settle();
    wheelRun([-30, -40, -30]);
    expectPage("B!", 1);
  });

  test("a second deliberate swipe the same way, inside the first one's tail, moves another page; tail bumps do not", () => {
    render(three());
    wheelRun([100, 100]);
    expectPage("B!", 1);
    // Decaying tail with a small bump: nothing.
    wheelRun([30, 22, 16, 12, 9, 7, 5, 4, 3, 12, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expectPage("B!", 1);
    // A fresh push: deltas several times the tail's.
    wheelRun([100, 100]);
    expectPage("C!", 2);
  });

  test("once a page is locked in, the next swipe counts immediately, in either direction", () => {
    render(three());
    wheelRun([120, 120, 30, 10, 4]);
    expectPage("B!", 1);
    wheelRun([120, 120, 30, 10, 4]);
    expectPage("C!", 2);
    wheelRun([-120, -120]);
    expectPage("B!", 1);
    swipe(300, 600);
    expectPage("A!", 0);
    swipe(600, 300);
    expectPage("B!", 1);
  });

  test("the dots show while a swipe is in progress and briefly after a page change", () => {
    render(three());
    expect(dots()).toHaveAttribute("data-visible", "false");
    const t = track();
    fireEvent.pointerDown(t, { pointerId: 1, clientX: 600, clientY: 100, pointerType: "touch", isPrimary: true });
    fireEvent.pointerMove(t, { pointerId: 1, clientX: 580, clientY: 101, pointerType: "touch" });
    expect(dots()).toHaveAttribute("data-visible", "true");
    fireEvent.pointerMove(t, { pointerId: 1, clientX: 300, clientY: 102, pointerType: "touch" });
    fireEvent.pointerUp(t, { pointerId: 1, clientX: 300, clientY: 102, pointerType: "touch" });
    expectPage("B!", 1);
    expect(dots()).toHaveAttribute("data-visible", "true");
    act(() => vi.advanceTimersByTime(2000));
    expect(dots()).toHaveAttribute("data-visible", "false");
  });

  test("the current page survives a reload; an unknown saved page falls back to home", () => {
    const { unmount } = render(three());
    fireEvent.click(screen.getByRole("tab", { name: "Status" }));
    expectPage("C!", 2);
    unmount();
    render(three());
    expectPage("C!", 2);
    localStorage.setItem("dashboard.page", "nope");
    const again = render(three({}));
    expect(again.container.querySelector('[data-page="a"]')).not.toHaveAttribute("aria-hidden", "true");
  });

  test("slots on hidden pages declare themselves hidden, and a page change re-declares at once", () => {
    vi.useRealTimers();
    render(
      <Pages home="a">
        <Page id="a" title="Tasks"><Slot module="clock" instance="a" /></Page>
        <Page id="b" title="Glance"><Slot module="clock" instance="b" /></Page>
      </Pages>,
    );
    const vis = () => Object.fromEntries(currentDeclarations().map((d) => [d.id, d.visible]));
    expect(vis()).toEqual({ "clock:a": true, "clock:b": false });
    fireEvent.click(screen.getByRole("tab", { name: "Glance" }));
    expect(vis()).toEqual({ "clock:a": false, "clock:b": true });
  });

  test("arrow keys move between pages", () => {
    render(three());
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expectPage("B!", 1);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expectPage("A!", 0);
  });

  test("returns_home_after_idle", () => {
    render(three({ returnHomeAfter: "5m" }));
    fireEvent.click(screen.getByRole("tab", { name: "Glance" }));
    act(() => vi.advanceTimersByTime(4 * 60_000));
    expectPage("B!", 1);
    act(() => { fireEvent.pointerDown(document.body); vi.advanceTimersByTime(4 * 60_000); });
    expectPage("B!", 1);
    act(() => vi.advanceTimersByTime(61_000));
    expectPage("A!", 0);
  });
});
