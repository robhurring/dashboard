import { beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ModuleFrame } from "./ModuleFrame";
import { OfflineBanner } from "./OfflineBanner";
import { registerComponent, type CustomProps } from "./registry";
import { useData } from "../data/store";
import { initialData } from "../data/reduce";
import type { Status } from "../protocol/Status";

const refresh = vi.fn();
vi.mock("../data/live", () => ({ getLive: () => ({ refresh, command: vi.fn().mockResolvedValue(undefined), rewatch: vi.fn(), start: vi.fn() }) }));

const status = (over: Partial<Status> = {}): Status => ({ ok: true, fetched_at: 1, pushed_at: null, writer: null, error: null, retry_at: null, loading: false, load_error: null, ...over });
const info = { id: "w", module: "weather", kind: "view" as const, component: null, title: null, icon: null, push_only: false };

beforeEach(() => useData.setState({ ...initialData }));

describe("ModuleFrame", () => {
  test("shows_a_load_error", () => {
    useData.setState({ catalog: [info], instances: { w: { rev: 0, kind: "view", state: null, config: {}, view: null, component: null, status: status({ ok: false, load_error: "no module named \"w\"" }) } } });
    render(<ModuleFrame id="w" />);
    expect(screen.getByRole("alert")).toHaveTextContent("no module named");
  });

  test("shows a spinner before the first snapshot", () => {
    useData.setState({ catalog: [info] });
    render(<ModuleFrame id="w" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
  });

  test("keeps the content and spins in the header only once a refetch has lasted a moment", () => {
    vi.useFakeTimers();
    const view = { type: "stat", props: { value: "58°" }, children: [] };
    useData.setState({ catalog: [info], instances: { w: { rev: 2, kind: "view", state: null, config: {}, view, component: null, status: status({ loading: true }) } } });
    const { rerender } = render(<ModuleFrame id="w" />);
    expect(screen.getByText("58°")).toBeInTheDocument();
    expect(screen.queryByTestId("loading-spinner")).toBeNull(); // fast fetches never blink
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
    useData.setState({ instances: { w: { rev: 3, kind: "view", state: null, config: {}, view, component: null, status: status() } } });
    rerender(<ModuleFrame id="w" />);
    expect(screen.queryByTestId("loading-spinner")).toBeNull();
    vi.useRealTimers();
  });

  test("content fades in when it replaces the loader", () => {
    useData.setState({ catalog: [info] });
    const { rerender } = render(<ModuleFrame id="w" />);
    const loader = screen.getByTestId("frame-body");
    expect(loader).toHaveClass("animate-fade-in");
    useData.setState({ instances: { w: { rev: 1, kind: "view", state: null, config: {}, view: { type: "stat", props: { value: "58°" }, children: [] }, component: null, status: status() } } });
    rerender(<ModuleFrame id="w" />);
    const body = screen.getByTestId("frame-body");
    expect(body).not.toBe(loader); // remounted, so the animation runs again
    expect(body).toHaveClass("animate-fade-in");
    expect(body).toHaveTextContent("58°");
  });

  test("a failed refresh says the panel is out of date, how old it is, and why; tapping retries", () => {
    const twelveMinutesAgo = Math.floor(Date.now() / 1000) - 12 * 60;
    useData.setState({ catalog: [info], instances: { w: { rev: 2, kind: "view", state: null, config: {}, view: { type: "stat", props: { value: "58°" }, children: [] }, component: null, status: status({ ok: false, error: "http 500", fetched_at: twelveMinutesAgo }) } } });
    render(<ModuleFrame id="w" title="Home" />);
    expect(screen.getByText("58°")).toBeInTheDocument();
    const stale = screen.getByRole("button", { name: /out of date/i });
    expect(stale).toHaveTextContent("Out of date · 12m");
    expect(stale).toHaveAttribute("title", expect.stringContaining("http 500"));
    fireEvent.click(stale);
    expect(refresh).toHaveBeenCalledWith("w");
  });

  test("a panel without a header still shows that it is out of date", () => {
    useData.setState({ catalog: [info], instances: { w: { rev: 2, kind: "view", state: null, config: {}, view: { type: "stat", props: { value: "58°" }, children: [] }, component: null, status: status({ ok: false, error: "timed out", fetched_at: Math.floor(Date.now() / 1000) - 2 * 3600 }) } } });
    render(<ModuleFrame id="w" chrome="none" />);
    expect(screen.getByRole("button", { name: /out of date/i })).toHaveTextContent("Out of date · 2h");
  });

  test("titles are templates over config, state and status; slot title overrides the module default", () => {
    useData.setState({ catalog: [{ ...info, title: "Weather: {{config.zip}}" }], instances: { w: { rev: 1, kind: "view", state: { sky: "Clouds" }, config: { zip: "07110" }, view: { type: "stat", props: { value: "1" }, children: [] }, component: null, status: status() } } });
    const { rerender } = render(<ModuleFrame id="w" />);
    expect(screen.getByRole("region")).toHaveAccessibleName("Weather: 07110");
    rerender(<ModuleFrame id="w" title="{{state.sky}} at home" />);
    expect(screen.getByRole("region")).toHaveAccessibleName("Clouds at home");
  });

  test("state modules render their custom component with state, config, status and send", async () => {
    const Panel = ({ state, config, title }: CustomProps) => <div>panel {String((state as { temp: number }).temp)} {String(config.zip)} {title}</div>;
    registerComponent("weather", "Weather", Panel);
    useData.setState({
      catalog: [{ id: "w", module: "weather", kind: "state", component: "Weather", title: null, icon: null, push_only: false }],
      instances: { w: { rev: 1, kind: "state", state: { temp: 64 }, config: { zip: "07110" }, view: null, component: "Weather", status: status() } },
    });
    render(<ModuleFrame id="w" title="Home" />);
    expect(await screen.findByText("panel 64 07110 Home")).toBeInTheDocument();
  });

  test("custom components own the slot: no panel or header unless the slot asks for chrome", async () => {
    registerComponent("todoist", "Plain", () => <div>plain</div>);
    useData.setState({
      catalog: [{ id: "p", module: "todoist", kind: "state", component: "Plain", title: null, icon: null, push_only: false }],
      instances: { p: { rev: 1, kind: "state", state: {}, config: {}, view: null, component: "Plain", status: status() } },
    });
    const { rerender } = render(<ModuleFrame id="p" title="Tasks" />);
    expect(await screen.findByText("plain")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Tasks" })).not.toHaveClass("bg-panel");
    expect(screen.queryByText("Tasks")).toBeNull();
    rerender(<ModuleFrame id="p" title="Tasks" chrome="full" />);
    expect(screen.getByRole("region", { name: "Tasks" })).toHaveClass("bg-panel");
    expect(screen.getByText("Tasks")).toBeInTheDocument();
  });

  test("a slot may pick another exported component of the module", async () => {
    registerComponent("todoist", "TodoistList", () => <div>list view</div>);
    useData.setState({
      catalog: [{ id: "t", module: "todoist", kind: "state", component: "TodoistBoard", title: null, icon: null, push_only: false }],
      instances: { t: { rev: 1, kind: "state", state: {}, config: {}, view: null, component: "TodoistBoard", status: status() } },
    });
    render(<ModuleFrame id="t" component="TodoistList" />);
    expect(await screen.findByText("list view")).toBeInTheDocument();
  });

  test("a custom component that throws shows an error in its own card only", async () => {
    const Boom = () => { throw new Error("kaboom"); };
    registerComponent("bad", "Boom", Boom);
    useData.setState({
      catalog: [{ id: "b", module: "bad", kind: "state", component: "Boom", title: null, icon: null, push_only: false }],
      instances: { b: { rev: 1, kind: "state", state: {}, config: {}, view: null, component: "Boom", status: status() } },
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ModuleFrame id="b" title="Bad" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("kaboom");
    expect(screen.getByRole("region", { name: "Bad" })).toBeInTheDocument();
    quiet.mockRestore();
  });

  test("a state module whose component is missing says so", () => {
    useData.setState({
      catalog: [{ id: "x", module: "nothing", kind: "state", component: "Nope", title: null, icon: null, push_only: false }],
      instances: { x: { rev: 1, kind: "state", state: {}, config: {}, view: null, component: "Nope", status: status() } },
    });
    render(<ModuleFrame id="x" />);
    expect(screen.getByText(/no component Nope/i)).toBeInTheDocument();
  });

  test("the header shows the slot's icon, or the module's default icon, in the accent color", () => {
    useData.setState({ catalog: [{ ...info, icon: "cloud-sun" }], instances: { w: { rev: 1, kind: "view", state: null, config: {}, view: { type: "stat", props: { value: "1" }, children: [] }, component: null, status: status() } } });
    const { rerender } = render(<ModuleFrame id="w" title="Weather" />);
    expect(document.querySelector('header [data-icon="cloud-sun"]')).not.toBeNull();
    rerender(<ModuleFrame id="w" title="Weather" icon="sun" />);
    expect(document.querySelector('header [data-icon="sun"]')).not.toBeNull();
    expect(document.querySelector('header [data-icon="cloud-sun"]')).toBeNull();
  });

  test("a push-only module before its first push renders its waiting state, not a spinner", async () => {
    registerComponent("slack", "SlackStats", ({ state }: CustomProps) => <div>{state ? "stats" : "Waiting for the first push"}</div>);
    useData.setState({
      catalog: [{ id: "slack", module: "slack", kind: "state", component: "SlackStats", title: null, icon: null, push_only: true }],
      instances: { slack: { rev: 0, kind: "state", state: null, config: {}, view: null, component: "SlackStats", status: status({ ok: false, fetched_at: null }) } },
    });
    render(<ModuleFrame id="slack" title="Slack" chrome="full" />);
    expect(await screen.findByText("Waiting for the first push")).toBeInTheDocument();
    expect(screen.queryByTestId("loading-spinner")).toBeNull();
    expect(screen.queryByRole("button", { name: /out of date/i })).toBeNull();
  });

  test("a push-only module whose only message so far is a status still renders its component", async () => {
    registerComponent("pushed", "Tiles", ({ state }: CustomProps) => <div>{state ? "tiles" : "Waiting for the first push"}</div>);
    useData.setState({ catalog: [{ id: "pushed", module: "pushed", kind: "state", component: "Tiles", title: null, icon: null, push_only: true }], instances: {} });
    // A status before any snapshot: what the server sends for an instance that has never had data.
    useData.getState().apply({ type: "status", instance: "pushed", status: status({ ok: false, fetched_at: null }) });
    render(<ModuleFrame id="pushed" title="Pushed" chrome="full" />);
    expect(await screen.findByText("Waiting for the first push")).toBeInTheDocument();
  });

  test("unknown instances say so", () => {
    render(<ModuleFrame id="nope" />);
    expect(screen.getByText(/Unknown instance/)).toBeInTheDocument();
  });
});

describe("OfflineBanner", () => {
  test("says the dashboard is updating while it reloads after a deploy", () => {
    useData.setState({ connection: "updating" });
    render(<OfflineBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("Updating the dashboard");
    expect(screen.getByRole("status")).not.toHaveTextContent("Offline");
  });

  test("hidden while online, visible otherwise", () => {
    useData.setState({ connection: "online" });
    const { rerender } = render(<OfflineBanner />);
    expect(screen.queryByRole("status")).toBeNull();
    useData.setState({ connection: "offline", lastMessageAt: Date.now() - 120_000 });
    rerender(<OfflineBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("Offline");
    expect(screen.getByRole("status")).toHaveTextContent("2m ago");
  });
});
