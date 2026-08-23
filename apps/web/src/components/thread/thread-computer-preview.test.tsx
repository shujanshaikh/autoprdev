// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDesktopPreview: vi.fn(),
  refreshDesktopActivity: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: (action: string) => action === "refreshDesktopActivity"
    ? mocks.refreshDesktopActivity
    : mocks.getDesktopPreview,
}));

vi.mock("@autopr/backend/convex/_generated/api", () => ({
  api: { projectActions: {
    getDesktopPreview: "getDesktopPreview",
    refreshDesktopActivity: "refreshDesktopActivity",
  } },
}));

vi.mock("./daytona-desktop-view", () => ({
  DaytonaDesktopView: ({
    websocketUrl,
    connectionRevision,
    onReconnectRequired,
  }: {
    websocketUrl?: string;
    connectionRevision?: number;
    onReconnectRequired?: (reason: "credentials" | "stream", failedRevision: number) => void;
  }) => (
    <div data-testid="desktop-view">
      {websocketUrl}:{connectionRevision}
      <button type="button" onClick={() => onReconnectRequired?.("stream", connectionRevision ?? 0)}>Simulate VNC disconnect</button>
    </div>
  ),
}));

import { ThreadComputerPreview } from "./thread-computer-preview";
import { resetDaytonaDesktopSessionsForTests } from "./daytona-desktop-connection";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  mocks.getDesktopPreview.mockResolvedValue({
    websocketUrl: "wss://desktop.example.test",
    expiresInSeconds: 600,
  });
  mocks.refreshDesktopActivity.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  resetDaytonaDesktopSessionsForTests();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ThreadComputerPreview", () => {
  it("opens on CUA activity, stays dismissed for that run, and reopens for the next run", async () => {
    const { rerender } = render(
      <ThreadComputerPreview projectId="project-1" activityKey="run-1" />,
    );

    const preview = await screen.findByRole("complementary", { name: "Live computer preview" });
    const closeButton = screen.getByRole("button", { name: "Close desktop preview" });
    expect(preview.className).toContain("rounded-md");
    expect(screen.queryByRole("button", { name: "Move desktop preview" })).toBeNull();
    expect(screen.getByTestId("desktop-view").parentElement?.contains(closeButton)).toBe(true);
    await waitFor(() => expect(mocks.getDesktopPreview).toHaveBeenCalledWith({ projectId: "project-1" }));
    expect(await screen.findByText("wss://desktop.example.test:1")).toBeTruthy();

    rerender(<ThreadComputerPreview projectId="project-1" activityKey="run-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Close desktop preview" }));
    expect(screen.queryByRole("complementary", { name: "Live computer preview" })).toBeNull();

    rerender(<ThreadComputerPreview projectId="project-1" activityKey="run-1" />);
    expect(screen.queryByRole("complementary", { name: "Live computer preview" })).toBeNull();

    rerender(<ThreadComputerPreview projectId="project-1" activityKey="run-2" />);
    expect(await screen.findByRole("complementary", { name: "Live computer preview" })).toBeTruthy();
  });

  it("scopes pending preview credentials to the project that requested them", async () => {
    const projectOne = deferred<{ websocketUrl: string; expiresInSeconds: number }>();
    const projectTwo = deferred<{ websocketUrl: string; expiresInSeconds: number }>();
    mocks.getDesktopPreview.mockImplementation(({ projectId }: { projectId: string }) =>
      projectId === "project-1" ? projectOne.promise : projectTwo.promise
    );
    const { rerender } = render(
      <ThreadComputerPreview projectId="project-1" activityKey="computer-1" />,
    );
    await waitFor(() => expect(mocks.getDesktopPreview).toHaveBeenCalledWith({ projectId: "project-1" }));

    rerender(<ThreadComputerPreview projectId="project-2" activityKey="computer-2" />);
    await waitFor(() => expect(mocks.getDesktopPreview).toHaveBeenCalledWith({ projectId: "project-2" }));
    await act(async () => {
      projectTwo.resolve({ websocketUrl: "wss://project-2.test", expiresInSeconds: 600 });
      await projectTwo.promise;
    });
    expect(await screen.findByText("wss://project-2.test:1")).toBeTruthy();

    await act(async () => {
      projectOne.resolve({ websocketUrl: "wss://project-1.test", expiresInSeconds: 600 });
      await projectOne.promise;
    });
    expect(screen.queryByText("wss://project-1.test:1")).toBeNull();
    expect(screen.getByText("wss://project-2.test:1")).toBeTruthy();
  });

  it("clears expired credentials when their refresh fails", async () => {
    mocks.getDesktopPreview
      .mockResolvedValueOnce({
        websocketUrl: "wss://expired.test",
        expiresInSeconds: 0,
      })
      .mockRejectedValueOnce(new Error("Preview refresh failed"));

    render(<ThreadComputerPreview projectId="project-1" activityKey="computer-1" />);

    expect(await screen.findByText("Preview refresh failed")).toBeTruthy();
    expect(screen.queryByText("wss://expired.test:1")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("replaces the signed WebSocket URL when noVNC requests reconnection", async () => {
    mocks.getDesktopPreview
      .mockResolvedValueOnce({
        websocketUrl: "wss://desktop-first.test",
        expiresInSeconds: 3_600,
      })
      .mockResolvedValueOnce({
        websocketUrl: "wss://desktop-renewed.test",
        expiresInSeconds: 3_600,
      });

    render(<ThreadComputerPreview projectId="project-1" activityKey="computer-1" />);

    expect(await screen.findByText("wss://desktop-first.test:1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Simulate VNC disconnect" }));

    expect(await screen.findByText("wss://desktop-renewed.test:2")).toBeTruthy();
    expect(mocks.getDesktopPreview).toHaveBeenCalledTimes(2);
    expect(mocks.getDesktopPreview).toHaveBeenLastCalledWith({
      projectId: "project-1",
      recoverStream: true,
    });
  });

  it("keeps rebuilding an RFB connection instead of permanently exhausting recovery", async () => {
    render(<ThreadComputerPreview projectId="project-1" activityKey="computer-1" />);

    expect(await screen.findByText("wss://desktop.example.test:1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Simulate VNC disconnect" }));
    expect(await screen.findByText("wss://desktop.example.test:2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Simulate VNC disconnect" }));
    expect(await screen.findByText("wss://desktop.example.test:3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Simulate VNC disconnect" }));

    expect(await screen.findByText("wss://desktop.example.test:4")).toBeTruthy();
    expect(screen.queryByText(/desktop stream could not be restored/i)).toBeNull();
    expect(mocks.getDesktopPreview).toHaveBeenCalledTimes(4);
  });

  it("keeps the current route mounted through a transient recovery failure", async () => {
    mocks.getDesktopPreview
      .mockResolvedValueOnce({
        websocketUrl: "wss://desktop-disconnected.test",
        expiresInSeconds: 3_600,
      })
      .mockRejectedValueOnce(new Error("Desktop services are unavailable"))
      .mockResolvedValueOnce({
        websocketUrl: "wss://desktop-restored.test",
        expiresInSeconds: 3_600,
      });

    render(<ThreadComputerPreview projectId="project-1" activityKey="computer-1" />);

    expect(await screen.findByText("wss://desktop-disconnected.test:1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Simulate VNC disconnect" }));
    await waitFor(() => expect(mocks.getDesktopPreview).toHaveBeenCalledTimes(2));

    expect(screen.getByText("wss://desktop-disconnected.test:1")).toBeTruthy();
    expect(screen.queryByText("Desktop services are unavailable")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Simulate VNC disconnect" }));
    expect(await screen.findByText("wss://desktop-restored.test:2")).toBeTruthy();
  });

  it("refreshes sandbox activity without rotating healthy noVNC credentials", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    render(<ThreadComputerPreview projectId="project-1" activityKey="computer-1" />);

    expect(await screen.findByText("wss://desktop.example.test:1")).toBeTruthy();
    const heartbeat = intervalSpy.mock.calls.at(-1)?.[0];
    if (typeof heartbeat !== "function") throw new Error("desktop heartbeat is missing");

    await act(async () => {
      heartbeat();
      await Promise.resolve();
    });

    expect(mocks.refreshDesktopActivity).toHaveBeenCalledExactlyOnceWith({ projectId: "project-1" });
    expect(mocks.getDesktopPreview).toHaveBeenCalledOnce();
    intervalSpy.mockRestore();
  });
});
