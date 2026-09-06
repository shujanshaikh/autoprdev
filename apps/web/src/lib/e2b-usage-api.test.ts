import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchE2BUsageEvents, mergeE2BExecutions } from "@autopr/backend/convex/lib/e2bUsage";

const rawEvent = {
  id: "event-1", type: "sandbox.lifecycle.paused", timestamp: "2026-09-06T00:01:00Z",
  sandbox_id: "sandbox-1", sandbox_execution_id: "run-1",
  event_data: { execution: {
    started_at: "2026-09-06T00:00:00Z", vcpu_count: 2, memory_mb: 512, execution_time: 60_000,
  } },
};

describe("E2B lifecycle API adapter", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("paginates the documented endpoint and normalizes both payload versions", async () => {
    vi.stubEnv("E2B_API_KEY", "test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(Array.from({ length: 100 }, (_, index) => ({ ...rawEvent, id: `event-${index}` }))))
      .mockResolvedValueOnce(Response.json([{
        id: "v1", type: "sandbox.lifecycle.killed", timestamp: "2026-09-06T00:02:00Z",
        sandboxId: "sandbox-1", sandboxExecutionId: "run-1", eventData: null,
      }]));
    vi.stubGlobal("fetch", fetchMock);
    const events = await fetchE2BUsageEvents("sandbox-1");
    expect(events).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const url = fetchMock.mock.calls[1]![0] as URL;
    expect(url.pathname).toBe("/events/sandboxes/sandbox-1");
    expect(url.searchParams.get("offset")).toBe("100");
    expect(url.searchParams.get("orderAsc")).toBe("true");
    expect(fetchMock.mock.calls[0]![1].headers).toEqual({ "X-API-Key": "test-key" });
    const executions = mergeE2BExecutions([], events);
    expect(executions).toHaveLength(1);
    expect(executions[0]?.runningMs).toBe(60_000);
  });

  it.each([401, 404, 429, 500])("does not turn an events API %s into zero usage", async (status) => {
    vi.stubEnv("E2B_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
    await expect(fetchE2BUsageEvents("sandbox-1")).rejects.toThrow(`(${status})`);
  });

  it("rejects malformed or unrelated provider payloads", async () => {
    vi.stubEnv("E2B_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(Response.json([{ ...rawEvent, sandbox_id: "another-sandbox" }]));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchE2BUsageEvents("sandbox-1")).rejects.toThrow("unexpected sandbox");
    fetchMock.mockResolvedValue(Response.json([{ ...rawEvent, timestamp: "not-a-date" }]));
    await expect(fetchE2BUsageEvents("sandbox-1")).rejects.toThrow();
  });
});
