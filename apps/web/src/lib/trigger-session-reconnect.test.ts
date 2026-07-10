import { describe, expect, it, vi } from "vitest";

import {
  runTriggerSessionReconnectAttempt,
  triggerSessionReconnectDelayMs,
} from "./trigger-session-reconnect";

describe("Trigger session reconnect", () => {
  it("retries when resume resolves without attaching while the turn is still live", async () => {
    const resume = vi.fn().mockResolvedValue(undefined);

    await expect(
      runTriggerSessionReconnectAttempt({
        resume,
        isSessionLive: () => true,
        isTurnCompleted: () => false,
      }),
    ).resolves.toEqual({ error: undefined, shouldRetry: true });
    expect(resume).toHaveBeenCalledOnce();
  });

  it("stops reconnecting when the turn completes during the resumed stream", async () => {
    let completed = false;

    const result = await runTriggerSessionReconnectAttempt({
      resume: async () => {
        completed = true;
      },
      isSessionLive: () => true,
      isTurnCompleted: () => completed,
    });

    expect(result).toEqual({ error: undefined, shouldRetry: false });
  });

  it("stops reconnecting when Convex reports that the turn settled", async () => {
    await expect(
      runTriggerSessionReconnectAttempt({
        resume: async () => undefined,
        isSessionLive: () => false,
        isTurnCompleted: () => false,
      }),
    ).resolves.toEqual({ error: undefined, shouldRetry: false });
  });

  it("retries a rejected resume while the durable turn remains live", async () => {
    const error = new TypeError("network disconnected");

    await expect(
      runTriggerSessionReconnectAttempt({
        resume: async () => {
          throw error;
        },
        isSessionLive: () => true,
        isTurnCompleted: () => false,
      }),
    ).resolves.toEqual({ error, shouldRetry: true });
  });

  it("backs off reconnect attempts and caps the delay", () => {
    expect([0, 1, 2, 3].map(triggerSessionReconnectDelayMs)).toEqual([
      250,
      500,
      1_000,
      2_000,
    ]);
    expect(triggerSessionReconnectDelayMs(20)).toBe(5_000);
  });
});
