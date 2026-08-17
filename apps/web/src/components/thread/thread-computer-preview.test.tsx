// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDesktopPreview: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: () => mocks.getDesktopPreview,
}));

vi.mock("@autopr/backend/convex/_generated/api", () => ({
  api: { projectActions: { getDesktopPreview: "getDesktopPreview" } },
}));

vi.mock("./daytona-desktop-view", () => ({
  DaytonaDesktopView: ({ websocketUrl }: { websocketUrl?: string }) => (
    <div data-testid="desktop-view">{websocketUrl}</div>
  ),
}));

import { ThreadComputerPreview, clampComputerPreviewPosition } from "./thread-computer-preview";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  mocks.getDesktopPreview.mockResolvedValue({
    websocketUrl: "wss://desktop.example.test",
    expiresInSeconds: 600,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ThreadComputerPreview", () => {
  it("opens on CUA activity, stays dismissed for that run, and reopens for the next run", async () => {
    const { rerender } = render(
      <ThreadComputerPreview projectId="project-1" activityKey="run-1" active />,
    );

    expect(await screen.findByRole("complementary", { name: "Live computer preview" })).toBeTruthy();
    await waitFor(() => expect(mocks.getDesktopPreview).toHaveBeenCalledWith({ projectId: "project-1" }));
    expect(await screen.findByText("wss://desktop.example.test")).toBeTruthy();

    rerender(<ThreadComputerPreview projectId="project-1" activityKey="run-1" active={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Close desktop preview" }));
    expect(screen.queryByRole("complementary", { name: "Live computer preview" })).toBeNull();

    rerender(<ThreadComputerPreview projectId="project-1" activityKey="run-1" active />);
    expect(screen.queryByRole("complementary", { name: "Live computer preview" })).toBeNull();

    rerender(<ThreadComputerPreview projectId="project-1" activityKey="run-2" active />);
    expect(await screen.findByRole("complementary", { name: "Live computer preview" })).toBeTruthy();
  });

  it("keeps dragged positions inside the thread boundary", () => {
    expect(clampComputerPreviewPosition(
      { x: -50, y: 900 },
      { width: 800, height: 600 },
      { width: 360, height: 235 },
    )).toEqual({ x: 12, y: 353 });
  });
});
