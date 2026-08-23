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

  it("retries the first short-lived noVNC connection without restarting the route", async () => {
    const onReconnectRequired = vi.fn(async () => true);
    render(createElement(DaytonaDesktopView, {
      websocketUrl: "wss://desktop.test/websockify",
      onReconnectRequired,
    }));
    await flushDesktopImport();

    act(() => {
      mocks.instances[0]?.dispatchEvent(new CustomEvent("connect"));
      mocks.instances[0]?.dispatchEvent(new CustomEvent("disconnect", { detail: { clean: false } }));
    });
    await flushDesktopImport();

    expect(onReconnectRequired).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(mocks.instances).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(1));

    expect(mocks.instances).toHaveLength(2);
    expect(mocks.instances[0]?.disconnect).not.toHaveBeenCalled();
  });

  it("backs off failed server recovery after bounded local retries", async () => {
    const onReconnectRequired = vi.fn(async () => false);
    render(createElement(DaytonaDesktopView, {
      websocketUrl: "wss://desktop.test/websockify",
      onReconnectRequired,
    }));
    await flushDesktopImport();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      act(() => {
        mocks.instances[attempt]?.dispatchEvent(new CustomEvent("connect"));
        mocks.instances[attempt]?.dispatchEvent(new CustomEvent("disconnect", {
          detail: { clean: false },
        }));
      });
      await flushDesktopImport();
      if (attempt < 2) await act(() => vi.advanceTimersByTimeAsync(300));
    }

    expect(onReconnectRequired).toHaveBeenCalledExactlyOnceWith("stream", 0);
    await act(() => vi.advanceTimersByTimeAsync(499));
    expect(onReconnectRequired).toHaveBeenCalledExactlyOnceWith("stream", 0);
    await act(() => vi.advanceTimersByTimeAsync(1));
    await flushDesktopImport();

    expect(onReconnectRequired).toHaveBeenCalledTimes(2);
    expect(mocks.instances).toHaveLength(3);
  });

  it("recovers when a noVNC handshake never completes", async () => {
    const onReconnectRequired = vi.fn(async () => true);
    render(createElement(DaytonaDesktopView, {
      websocketUrl: "wss://desktop.test/websockify",
      onReconnectRequired,
    }));
    await flushDesktopImport();

    await act(() => vi.advanceTimersByTimeAsync(15_000));
    await flushDesktopImport();

    expect(onReconnectRequired).toHaveBeenCalledExactlyOnceWith("stream", 0);
    expect(mocks.instances).toHaveLength(1);
  });

  it("renews credentials immediately instead of opening an expiring signed URL", async () => {
    const onReconnectRequired = vi.fn(async () => true);
    render(createElement(DaytonaDesktopView, {
      websocketUrl: "wss://desktop-expiring.test/websockify",
      websocketUrlExpiresAt: Date.now() + 10_000,
      onReconnectRequired,
    }));
    await flushDesktopImport();

    expect(onReconnectRequired).toHaveBeenCalledExactlyOnceWith("credentials", 0);
    expect(mocks.instances).toHaveLength(0);
  });

  it("keeps renewing expired credentials after a transient owner failure", async () => {
    const onReconnectRequired = vi.fn(async () => false);
    render(createElement(DaytonaDesktopView, {
      websocketUrl: "wss://desktop-expired.test/websockify",
      websocketUrlExpiresAt: Date.now(),
      onReconnectRequired,
    }));
    await flushDesktopImport();

    expect(onReconnectRequired).toHaveBeenCalledExactlyOnceWith("credentials", 0);
    await act(() => vi.advanceTimersByTimeAsync(500));
    await flushDesktopImport();

    expect(onReconnectRequired).toHaveBeenCalledTimes(2);
    expect(mocks.instances).toHaveLength(0);
  });

  it("opens a fresh RFB client when recovery returns the same signed URL", async () => {
    const { rerender } = render(createElement(DaytonaDesktopView, {
      websocketUrl: "wss://desktop.test/websockify",
      connectionRevision: 1,
    }));
    await flushDesktopImport();

    rerender(createElement(DaytonaDesktopView, {
      websocketUrl: "wss://desktop.test/websockify",
      connectionRevision: 2,
    }));
    await flushDesktopImport();

    expect(mocks.instances).toHaveLength(2);
    expect(mocks.instances[0]?.disconnect).toHaveBeenCalledOnce();
  });

  it("cancels recovery timers after both desktop viewports connect", async () => {
    const onReconnectRequired = vi.fn();
    render(createElement(DaytonaDesktopView, {
      websocketUrl: "wss://desktop.test/websockify",
      connectionRevision: 4,
      onReconnectRequired,
    }));
    await flushDesktopImport();
    render(createElement(DaytonaDesktopView, {
      websocketUrl: "wss://desktop.test/websockify",
      connectionRevision: 4,
      interactive: false,
      onReconnectRequired,
    }));
    await flushDesktopImport();

    expect(mocks.instances).toHaveLength(2);
    act(() => {
      mocks.instances[0]?.dispatchEvent(new CustomEvent("connect"));
      mocks.instances[1]?.dispatchEvent(new CustomEvent("connect"));
    });
    await act(() => vi.advanceTimersByTimeAsync(20_000));

    expect(onReconnectRequired).not.toHaveBeenCalled();
    expect(mocks.instances).toHaveLength(2);
  });
});
