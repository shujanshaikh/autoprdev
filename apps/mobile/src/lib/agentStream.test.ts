import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";

import { consumeAgentRunStream } from "./agentStream";

function chunkResponse(...chunks: UIMessageChunk[]) {
  return createUIMessageStreamResponse({
    stream: new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  });
}

describe("consumeAgentRunStream", () => {
  it("resumes from the next indexed chunk after a stream closes", async () => {
    const fetchAuthenticated = vi.fn()
      .mockResolvedValueOnce(chunkResponse({ type: "start", messageId: "assistant-1" }))
      .mockResolvedValueOnce(chunkResponse({ type: "finish" }));
    const statuses: string[] = [];

    await consumeAgentRunStream({
      runId: "run-1",
      streamPath: "/agent/run-1/stream",
      fetchAuthenticated,
      signal: new AbortController().signal,
      onMessage: () => undefined,
      onStatus: (status) => statuses.push(status),
    });

    expect(fetchAuthenticated).toHaveBeenCalledTimes(2);
    expect(fetchAuthenticated.mock.calls[0]?.[0]).toContain("startIndex=0");
    expect(fetchAuthenticated.mock.calls[1]?.[0]).toContain("startIndex=1");
    expect(statuses).toContain("streaming");
  });

  it("does not retry permanent HTTP failures", async () => {
    const fetchAuthenticated = vi.fn().mockResolvedValue(
      new Response("unauthorized", { status: 401 }),
    );

    await expect(consumeAgentRunStream({
      runId: "run-2",
      streamPath: "/agent/run-2/stream",
      fetchAuthenticated,
      signal: new AbortController().signal,
      onMessage: () => undefined,
      onStatus: () => undefined,
    })).rejects.toThrow("Could not read the agent response (401)");
    expect(fetchAuthenticated).toHaveBeenCalledTimes(1);
  });
});
