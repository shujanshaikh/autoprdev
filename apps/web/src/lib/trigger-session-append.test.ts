import { describe, expect, it, vi } from "vitest";

import { appendToTriggerSession, triggerSessionAppendRetryDelayMs } from "./trigger-session-append";

describe("Trigger session append", () => {
  it("retries transient 500 responses with one stable idempotency key", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: "HTTPError" }, { status: 500 }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const waitForRetry = vi.fn().mockResolvedValue(undefined);

    const response = await appendToTriggerSession({
      url: "https://api.trigger.dev/realtime/v1/sessions/thread-1/in/append",
      body: JSON.stringify({ kind: "message" }),
      headers: { Authorization: "Bearer token" },
      fetcher,
      waitForRetry,
    });

    expect(response.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(waitForRetry).toHaveBeenCalledWith(200, undefined);

    const firstHeaders = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    const secondHeaders = new Headers(fetcher.mock.calls[1]?.[1]?.headers);
    expect(firstHeaders.get("X-Part-Id")).toBeTruthy();
    expect(secondHeaders.get("X-Part-Id")).toBe(
      firstHeaders.get("X-Part-Id"),
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
  });

  it("preserves the transport idempotency key across retries", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await appendToTriggerSession({
      url: "https://api.trigger.dev/realtime/v1/sessions/thread-1/in/append",
      body: JSON.stringify({ kind: "stop" }),
      headers: { "X-Part-Id": "browser-send-id" },
      fetcher,
      waitForRetry: async () => undefined,
    });

    for (const call of fetcher.mock.calls) {
      expect(new Headers(call[1]?.headers).get("X-Part-Id")).toBe(
        "browser-send-id",
      );
    }
  });

  it("does not retry permanent client errors", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({ error: "Session is closed" }, { status: 409 }),
    );
    const waitForRetry = vi.fn().mockResolvedValue(undefined);

    const response = await appendToTriggerSession({
      url: "https://api.trigger.dev/realtime/v1/sessions/thread-1/in/append",
      body: JSON.stringify({ kind: "message" }),
      headers: {},
      fetcher,
      waitForRetry,
    });

    expect(response.status).toBe(409);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(waitForRetry).not.toHaveBeenCalled();
  });

  it("returns the final response after a bounded number of retries", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () => new Response(null, { status: 500 }));
    const waitForRetry = vi.fn().mockResolvedValue(undefined);

    const response = await appendToTriggerSession({
      url: "https://api.trigger.dev/realtime/v1/sessions/thread-1/in/append",
      body: JSON.stringify({ kind: "message" }),
      headers: {},
      fetcher,
      waitForRetry,
    });

    expect(response.status).toBe(500);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(waitForRetry).toHaveBeenCalledTimes(3);
  });

  it("caps its exponential backoff", () => {
    expect([0, 1, 2, 3, 10].map(triggerSessionAppendRetryDelayMs)).toEqual([
      200,
      400,
      800,
      1_000,
      1_000,
    ]);
  });

  it("rejects non-HTTPS and mismatched append origins before sending credentials", async () => {
    const fetcher = vi.fn();

    await expect(appendToTriggerSession({
      url: "http://api.trigger.dev/realtime/v1/sessions/thread-1/in/append",
      body: "{}",
      headers: { Authorization: "Bearer token" },
      fetcher,
    })).rejects.toThrow("require HTTPS");
    await expect(appendToTriggerSession({
      url: "https://attacker.example/realtime/v1/sessions/thread-1/in/append",
      trustedOrigin: "https://api.trigger.dev",
      body: "{}",
      headers: { Authorization: "Bearer token" },
      fetcher,
    })).rejects.toThrow("does not match");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("times out and retries a stalled append attempt", async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        if (fetcher.mock.calls.length === 2) resolve(new Response(null, { status: 200 }));
      }),
    );

    const response = await appendToTriggerSession({
      url: "https://api.trigger.dev/realtime/v1/sessions/thread-1/in/append",
      body: "{}",
      headers: {},
      fetcher,
      waitForRetry: async () => undefined,
      attemptTimeoutMs: 5,
    });

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
