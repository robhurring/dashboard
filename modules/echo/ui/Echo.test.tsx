import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Echo } from "./index";

const props = (state: unknown, send = vi.fn().mockResolvedValue(undefined)) => ({
  state: state as never, config: {}, status: null, send, title: "Echo", density: "normal" as const,
});

describe("Echo", () => {
  test("shows the messages and pong count from state", () => {
    render(<Echo {...props({ messages: [{ text: "hello", at: 1 }], pings: 2 })} />);
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("2 pongs")).toBeInTheDocument();
  });

  test("sending runs the echo command with the typed text and clears the box", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    render(<Echo {...props({ messages: [], pings: 0 }, send)} />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "hi there" } });
    fireEvent.click(screen.getByRole("button", { name: "Echo" }));
    expect(send).toHaveBeenCalledWith("echo", { text: "hi there" });
    await waitFor(() => expect(box).toHaveValue(""));
  });

  test("ping runs the ping command", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    render(<Echo {...props({ messages: [], pings: 0 }, send)} />);
    fireEvent.click(screen.getByRole("button", { name: "Ping" }));
    expect(send).toHaveBeenCalledWith("ping", undefined);
  });

  test("a rejected command shows its error and keeps the text", async () => {
    const send = vi.fn().mockRejectedValue(new Error("say something first"));
    render(<Echo {...props({ messages: [], pings: 0 }, send)} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Echo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("say something first");
    expect(screen.getByRole("textbox")).toHaveValue("x");
  });
});
