import { describe, expect, it, vi } from "vitest";

import {
  isRetryableDesktopPreviewError,
  requestDesktopPreviewWithRetry,
} from "./daytona-desktop-connection";

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
});
