import { afterEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { WidgetTree } from "./WidgetTree";

const tree = (type: string, props: Record<string, unknown>) => <WidgetTree node={{ type, props, children: [] } as never} send={vi.fn()} />;
afterEach(() => vi.restoreAllMocks());

describe("ui.image", () => {
  test("shows base64 data as an image, with its type, alt text and fit", () => {
    render(tree("image", { data: "iVBORw0KGgo=", type: "image/png", alt: "Garden at dawn", fit: "cover" }));
    const img = screen.getByRole("img", { name: "Garden at dawn" });
    expect(img).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo=");
    expect(img.className).toContain("object-cover");
  });

  test("accepts a full data URL, and defaults to PNG and contain", () => {
    // Without alt text an image is decorative, so it's found as an element rather than by role.
    const { container, rerender } = render(tree("image", { data: "data:image/webp;base64,UklGRg==" }));
    expect(container.querySelector("img")).toHaveAttribute("src", "data:image/webp;base64,UklGRg==");
    rerender(tree("image", { data: "AAAA" }));
    expect(container.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,AAAA");
    expect(container.querySelector("img")!.className).toContain("object-contain");
  });
});

test("ui.image and ui.audio take a URL in src instead of data", () => {
  const { container } = render(<>{tree("image", { src: "https://example.com/garden.jpg", alt: "Garden" })}{tree("audio", { src: "https://example.com/news.mp3" })}</>);
  expect(screen.getByRole("img", { name: "Garden" })).toHaveAttribute("src", "https://example.com/garden.jpg");
  expect(container.querySelector("audio")).toHaveAttribute("src", "https://example.com/news.mp3");
});

describe("ui.audio", () => {
  test("plays and stops from base64 data", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const { container } = render(tree("audio", { data: "SUQz", label: "Morning briefing" }));
    expect(container.querySelector("audio")).toHaveAttribute("src", "data:audio/mpeg;base64,SUQz");
    expect(screen.getByText("Morning briefing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play Morning briefing" }));
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.play(container.querySelector("audio")!);
    fireEvent.click(screen.getByRole("button", { name: "Stop Morning briefing" }));
    expect(pause).toHaveBeenCalledTimes(1);
  });

  test("with autoplay, each new clip plays as it arrives, and not the first one already on screen at load", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const { rerender } = render(tree("audio", { data: "AAAA", autoplay: true }));
    expect(play).not.toHaveBeenCalled();
    await act(async () => { rerender(tree("audio", { data: "BBBB", autoplay: true })); });
    expect(play).toHaveBeenCalledTimes(1);
  });

  test("a blocked autoplay leaves a tap-to-play button instead of failing", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
    const { rerender } = render(tree("audio", { data: "AAAA", autoplay: true, label: "News" }));
    await act(async () => { rerender(tree("audio", { data: "BBBB", autoplay: true, label: "News" })); });
    expect(screen.getByRole("button", { name: "Play News" })).toBeInTheDocument();
  });
});
