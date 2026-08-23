import { describe, expect, it, vi } from "vitest";

import {
  DESKTOP_PREVIEW_HEARTBEAT_MS,
  isRetryableDesktopPreviewError,
  requestDesktopPreviewWithRetry,
  requestSharedDesktopPreview,
  subscribeDesktopActivity,
} from "./daytona-desktop-connection";

const preview = {
  expiresInSeconds: 3_600,
  port: 6_080,
  url: "https://desktop.test",
  websocketUrl: "wss://desktop.test",
};

describe("Daytona desktop connection", () => {
  it("recognizes Convex auth refresh and network failures as transient", () => {
    expect(isRetryableDesktopPreviewError(new Error('Uncaught ConvexError: {"code":"UNAUTHORIZED"}')))
      .toBe(true);
    expect(isRetryableDesktopPreviewError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetryableDesktopPreviewError(new Error("Project not found"))).toBe(false);
  });

  it("retries a preview request while Convex rotates its auth token", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('Uncaught ConvexError: {"code":"UNAUTHORIZED"}'))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({ websocketUrl: "wss://desktop.test" });

    await expect(requestDesktopPreviewWithRetry(request, [0, 0]))
      .resolves.toEqual({ websocketUrl: "wss://desktop.test" });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("does not repeat a permanent Daytona failure", async () => {
    const request = vi.fn().mockRejectedValue(new Error("x11vnc did not become ready"));

    await expect(requestDesktopPreviewWithRetry(request, [0, 0]))
      .rejects.toThrow("x11vnc did not become ready");
    expect(request).toHaveBeenCalledOnce();
  });

  it("shares one in-flight credential request between desktop viewers", async () => {
    let resolvePreview: ((value: typeof preview) => void) | undefined;
    const pendingPreview = new Promise<typeof preview>((resolve) => {
      resolvePreview = resolve;
    });
    const request = vi.fn(() => pendingPreview);

    const compact = requestSharedDesktopPreview("project-shared", false, request);
    const full = requestSharedDesktopPreview("project-shared", false, request);
    resolvePreview?.(preview);

    await expect(Promise.all([compact, full])).resolves.toEqual([preview, preview]);
    expect(request).toHaveBeenCalledOnce();
  });

  it("shares one activity heartbeat between desktop viewers", async () => {
    vi.useFakeTimers();
    const compactRefresh = vi.fn(async () => undefined);
    const fullRefresh = vi.fn(async () => undefined);
    const closeCompact = subscribeDesktopActivity("project-active", compactRefresh);
    const closeFull = subscribeDesktopActivity("project-active", fullRefresh);

    try {
      await vi.advanceTimersByTimeAsync(DESKTOP_PREVIEW_HEARTBEAT_MS);
      expect(compactRefresh).toHaveBeenCalledOnce();
      expect(fullRefresh).not.toHaveBeenCalled();

      closeCompact();
      await vi.advanceTimersByTimeAsync(DESKTOP_PREVIEW_HEARTBEAT_MS);
      expect(fullRefresh).toHaveBeenCalledOnce();
    } finally {
      closeCompact();
      closeFull();
      vi.useRealTimers();
    }
  });
});
