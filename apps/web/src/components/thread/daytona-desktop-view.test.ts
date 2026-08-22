// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockRfbInstance = EventTarget & {
  disconnect: ReturnType<typeof vi.fn>;
  url: string;
};

const mocks = vi.hoisted(() => ({
  instances: [] as MockRfbInstance[],
}));

vi.mock("@novnc/novnc", () => ({
  default: class MockRfb extends EventTarget {
    scaleViewport = false;
    resizeSession = false;
    clipViewport = false;
    viewOnly = false;
    background = "";
    disconnect = vi.fn();
    focus = vi.fn();

    constructor(_target: HTMLElement, readonly url: string) {
      super();
      mocks.instances.push(this);
    }
  },
}));

import { DaytonaDesktopView } from "./daytona-desktop-view";

async function flushDesktopImport() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.instances.length = 0;
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    bottom: 203,
    height: 203,
    left: 0,
    right: 360,
    top: 0,
    width: 360,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DaytonaDesktopView", () => {
  it("keeps a successful noVNC connection open without judging framebuffer brightness", async () => {
    const onReconnectRequired = vi.fn();
    render(createElement(DaytonaDesktopView, {
      websocketUrl: "wss://desktop.test/websockify",
      onReconnectRequired,
    }));
    await flushDesktopImport();

    expect(mocks.instances).toHaveLength(1);
    act(() => mocks.instances[0]?.dispatchEvent(new CustomEvent("connect")));
    await act(() => vi.advanceTimersByTimeAsync(15_000));

    expect(mocks.instances).toHaveLength(1);
    expect(mocks.instances[0]?.disconnect).not.toHaveBeenCalled();
    expect(onReconnectRequired).not.toHaveBeenCalled();
  });

  it("renews the signed URL after repeated short-lived noVNC connections", async () => {
    const onReconnectRequired = vi.fn();
    render(createElement(DaytonaDesktopView, {
      websocketUrl: "wss://desktop.test/websockify",
      onReconnectRequired,
    }));
    await flushDesktopImport();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const rfb = mocks.instances[attempt];
      expect(rfb).toBeDefined();
      act(() => {
        rfb?.dispatchEvent(new CustomEvent("connect"));
        rfb?.dispatchEvent(new CustomEvent("disconnect", { detail: { clean: false } }));
      });
      await act(() => vi.advanceTimersByTimeAsync(300));
    }

    expect(onReconnectRequired).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.instances).toHaveLength(3);
  });

  it("recovers when a noVNC handshake never completes", async () => {
    render(createElement(DaytonaDesktopView, {
      websocketUrl: "wss://desktop.test/websockify",
    }));
    await flushDesktopImport();

    await act(() => vi.advanceTimersByTimeAsync(15_000));
    await act(() => vi.advanceTimersByTimeAsync(300));

    expect(mocks.instances).toHaveLength(2);
  });
});
