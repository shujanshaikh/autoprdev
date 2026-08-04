import { createUIMessageStreamResponse, type UIMessage, type UIMessageChunk } from "ai";
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

function chunkResponseThenError(chunk: UIMessageChunk) {
  let emitted = false;
  return createUIMessageStreamResponse({
    stream: new ReadableStream<UIMessageChunk>({
      pull(controller) {
        if (!emitted) {
          emitted = true;
          controller.enqueue(chunk);
          return;
        }
        controller.error(new Error("connection changed"));
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

  it("stops reconnecting after repeated empty responses", async () => {
    vi.useFakeTimers();
    const fetchAuthenticated = vi.fn().mockImplementation(async () => chunkResponse());
    const consume = consumeAgentRunStream({
      runId: "run-empty",
      streamPath: "/agent/run-empty/stream",
      fetchAuthenticated,
      signal: new AbortController().signal,
      onMessage: () => undefined,
      onStatus: () => undefined,
    });

    try {
      const rejection = expect(consume).rejects.toThrow("The live response produced no output.");
      await vi.runAllTimersAsync();
      await rejection;
      expect(fetchAuthenticated).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues a stream that omits start by using the canonical assistant message", async () => {
    const fetchAuthenticated = vi.fn()
      .mockResolvedValueOnce(chunkResponse(
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "Smooth" },
      ))
      .mockResolvedValueOnce(chunkResponse(
        { type: "text-end", id: "text-1" },
        { type: "finish" },
      ));
    const messages: UIMessage[] = [];

    const result = await consumeAgentRunStream({
      runId: "run-without-start",
      streamPath: "/agent/run-without-start/stream",
      fetchAuthenticated,
      signal: new AbortController().signal,
      initialMessage: { id: "assistant-canonical", role: "assistant", parts: [] },
      onMessage: (message) => messages.push(message),
      onStatus: () => undefined,
    });

    expect(result?.id).toBe("assistant-canonical");
    expect(messages.at(-1)?.parts).toEqual([
      { type: "text", text: "Smooth", state: "done", providerMetadata: undefined },
    ]);
  });

  it("does not exhaust retries when each connection makes progress", async () => {
    const fetchAuthenticated = vi.fn();
    const progressingChunks: UIMessageChunk[] = [
      { type: "start", messageId: "assistant-progress" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Still " },
      { type: "text-delta", id: "text-1", delta: "making " },
      { type: "text-delta", id: "text-1", delta: "steady " },
      { type: "text-delta", id: "text-1", delta: "progress" },
    ];
    for (const chunk of progressingChunks) {
      fetchAuthenticated.mockResolvedValueOnce(chunkResponseThenError(chunk));
    }
    fetchAuthenticated.mockResolvedValueOnce(chunkResponse(
      { type: "text-end", id: "text-1" },
      { type: "finish" },
    ));

    await expect(consumeAgentRunStream({
      runId: "run-progress",
      streamPath: "/agent/run-progress/stream",
      fetchAuthenticated,
      signal: new AbortController().signal,
      onMessage: () => undefined,
      onStatus: () => undefined,
    })).resolves.toBeDefined();
    expect(fetchAuthenticated).toHaveBeenCalledTimes(7);
  });
});
