import { describe, expect, it, vi } from "vitest";

import {
  createDaytonaDesktopSession,
  DESKTOP_PREVIEW_HEARTBEAT_MS,
  isRetryableDesktopPreviewError,
  requestDesktopPreviewWithRetry,
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

  it("absorbs a second viewer's stale failure after one route recovery", async () => {
    const session = createDaytonaDesktopSession("project-shared");
    const compactRevisions: number[] = [];
    const fullRevisions: number[] = [];
    const closeCompact = session.subscribe(() => {
      const revision = session.getSnapshot().connection?.revision;
      if (revision !== undefined) compactRevisions.push(revision);
    });
    const closeFull = session.subscribe(() => {
      const revision = session.getSnapshot().connection?.revision;
      if (revision !== undefined) fullRevisions.push(revision);
    });

    await session.request(async () => preview);
    const failedRevision = session.getSnapshot().connection?.revision;
    if (failedRevision === undefined) throw new Error("initial desktop route is missing");

    let resolveRecovery: ((value: typeof preview) => void) | undefined;
    const recoveryPreview = new Promise<typeof preview>((resolve) => {
      resolveRecovery = resolve;
    });
    const recover = vi.fn(() => recoveryPreview);
    const compactRecovery = session.request(recover, {
      recoverStream: true,
      preserveConnection: true,
      failedRevision,
    });
    const fullRecovery = session.request(recover, {
      recoverStream: true,
      preserveConnection: true,
      failedRevision,
    });

    resolveRecovery?.({ ...preview, websocketUrl: "wss://desktop-recovered.test" });
    await expect(Promise.all([compactRecovery, fullRecovery])).resolves.toEqual([true, true]);

    expect(recover).toHaveBeenCalledOnce();
    expect(session.getSnapshot().connection).toMatchObject({
      websocketUrl: "wss://desktop-recovered.test",
      revision: failedRevision + 1,
    });
    expect(compactRevisions.at(-1)).toBe(failedRevision + 1);
    expect(fullRevisions.at(-1)).toBe(failedRevision + 1);

    await expect(session.request(recover, {
      recoverStream: true,
      preserveConnection: true,
      failedRevision,
    })).resolves.toBe("current");
    expect(recover).toHaveBeenCalledOnce();

    closeCompact();
    closeFull();
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
