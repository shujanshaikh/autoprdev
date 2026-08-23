import {
  previewWebsocketUrl,
  waitForPreviewRoute,
} from "@autopr/backend/convex/lib/daytonaPreview";
import { describe, expect, it, vi } from "vitest";

describe("Daytona preview routing", () => {
  it("preserves a signed token path when adding the WebSocket route", () => {
    expect(previewWebsocketUrl(
      "https://6080-sandbox.proxy.daytona.work/signed-token/?expires=123",
      "/websockify",
    )).toBe(
      "wss://6080-sandbox.proxy.daytona.work/signed-token/websockify?expires=123",
    );
  });

  it("waits for Daytona's public route instead of trusting only the VM port", async () => {
    const probe = vi.fn()
      .mockResolvedValueOnce(503)
      .mockRejectedValueOnce(new TypeError("connection closed"))
      .mockResolvedValueOnce(200);

    await expect(waitForPreviewRoute("https://desktop.test", {
      probe,
      retryDelaysMs: [0, 0, 0],
    })).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("rejects a signed route that never becomes reachable", async () => {
    const probe = vi.fn().mockResolvedValue(503);

    await expect(waitForPreviewRoute("https://desktop.test", {
      probe,
      retryDelaysMs: [0, 0],
    })).rejects.toThrow("HTTP 503");
  });
});
