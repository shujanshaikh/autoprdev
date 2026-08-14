import { describe, expect, it, vi } from "vitest";

import {
  discardUnpersistedAssistantTail,
  runTriggerSessionReconnectAttempt,
  triggerSessionReconnectDelayMs,
  shouldUseTriggerSessionTransport,
  triggerSessionHydration,
} from "./trigger-session-reconnect";

describe("discardUnpersistedAssistantTail", () => {
  it("removes a partial assistant response before replaying from a persisted cursor", () => {
    const persisted = [{ id: "user_1", role: "user" as const, parts: [] }];
    const partialAssistant = {
      id: "assistant_live",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Partial", state: "streaming" as const }],
    };

    expect(discardUnpersistedAssistantTail([...persisted, partialAssistant], persisted))
      .toEqual(persisted);
  });

  it("preserves an assistant response that is already persisted", () => {
    const persisted = [{
      id: "assistant_done",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Done" }],
    }];

    expect(discardUnpersistedAssistantTail(persisted, persisted)).toBe(persisted);
  });
});

describe("Trigger session reconnect", () => {
  it("selects the durable Session transport for an active session turn", () => {
    expect(
      shouldUseTriggerSessionTransport({
        sessionCreatedAt: Date.now(),
        currentRunId: "run_live_session",
        currentRunTransport: "session",
      }),
    ).toBe(true);
  });

  it("uses the shared run-scoped stream while idle and for task turns", () => {
    expect(shouldUseTriggerSessionTransport({})).toBe(false);
    expect(
      shouldUseTriggerSessionTransport({ sessionCreatedAt: Date.now() }),
    ).toBe(false);
    expect(
      shouldUseTriggerSessionTransport({
        sessionCreatedAt: Date.now(),
        currentRunId: "run_task",
        currentRunTransport: "task",
      }),
    ).toBe(false);
  });

  it("recognizes active session turns written before transport markers", () => {
    expect(
      shouldUseTriggerSessionTransport({
        sessionCreatedAt: Date.now(),
        currentRunId: "run_legacy_session",
      }),
    ).toBe(true);
    expect(
      shouldUseTriggerSessionTransport({ currentRunId: "run_legacy_task" }),
    ).toBe(false);
  });

  it("hydrates the transport with the completed-turn cursor and lets the server decide settled state", () => {
    expect(triggerSessionHydration("session-token", "42")).toEqual({
      publicAccessToken: "session-token",
      lastEventId: "42",
    });
    expect(triggerSessionHydration("session-token")).not.toHaveProperty(
      "isStreaming",
    );
  });

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
