import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TriggerChatTransport } from "./trigger-chat-transport";

afterEach(() => {
  vi.restoreAllMocks();
});

function chunkResponse(...chunks: UIMessageChunk[]) {
  return createUIMessageStreamResponse({
    stream: new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }),
  });
}

async function collect(stream: ReadableStream<UIMessageChunk>) {
  const chunks: UIMessageChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe("TriggerChatTransport", () => {
  it("returns from the start request and reads all output from the Trigger.dev run stream", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 202,
          headers: { "x-trigger-run-id": "run_123" },
        }),
      )
      .mockResolvedValueOnce(chunkResponse({ type: "finish" }));
    const onChatSendMessage = vi.fn();
    const transport = new TriggerChatTransport({
      api: "http://localhost/api/agent",
      fetch: fetchMock,
      onChatSendMessage,
    });

    const stream = await transport.sendMessages({
      chatId: "chat_123",
      messages: [{ id: "message_123", role: "user", parts: [{ type: "text", text: "hi" }] }],
      trigger: "submit-message",
    });

    await expect(collect(stream)).resolves.toEqual([{ type: "finish" }]);
    expect(onChatSendMessage).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL("http://localhost/api/agent/run_123/stream?startIndex=0"),
      expect.objectContaining({ signal: undefined }),
    );
  });

  it("reconnects from the next chunk index when a realtime request closes", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, {
        status: 202,
        headers: { "x-trigger-run-id": "run_456" },
      }))
      .mockResolvedValueOnce(chunkResponse({ type: "start", messageId: "assistant_1" }))
      .mockResolvedValueOnce(chunkResponse({ type: "finish" }));
    const transport = new TriggerChatTransport({
      api: "http://localhost/api/agent",
      fetch: fetchMock,
    });

    const stream = await transport.sendMessages({
      chatId: "chat_456",
      messages: [{ id: "message_456", role: "user", parts: [{ type: "text", text: "hi" }] }],
      trigger: "submit-message",
    });

    await expect(collect(stream)).resolves.toEqual([
      { type: "start", messageId: "assistant_1" },
      { type: "finish" },
    ]);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("startIndex=1");
  });

  it("retries a transient network failure without losing the run", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 202,
          headers: { "x-trigger-run-id": "run_network_retry" },
        }),
      )
      .mockRejectedValueOnce(new TypeError("network disconnected"))
      .mockResolvedValueOnce(chunkResponse({ type: "finish" }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const transport = new TriggerChatTransport({
      api: "http://localhost/api/agent",
      fetch: fetchMock,
      reconnectDelayInMs: 0,
    });

    const stream = await transport.sendMessages({
      chatId: "chat_network_retry",
      messages: [
        {
          id: "message_network_retry",
          role: "user",
          parts: [{ type: "text", text: "hi" }],
        },
      ],
      trigger: "submit-message",
    });

    await expect(collect(stream)).resolves.toEqual([{ type: "finish" }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries transient HTTP failures", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 202,
          headers: { "x-trigger-run-id": "run_http_retry" },
        }),
      )
      .mockResolvedValueOnce(new Response("temporarily unavailable", { status: 503 }))
      .mockResolvedValueOnce(chunkResponse({ type: "finish" }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const transport = new TriggerChatTransport({
      api: "http://localhost/api/agent",
      fetch: fetchMock,
      reconnectDelayInMs: 0,
    });

    const stream = await transport.sendMessages({
      chatId: "chat_http_retry",
      messages: [
        {
          id: "message_http_retry",
          role: "user",
          parts: [{ type: "text", text: "hi" }],
        },
      ],
      trigger: "submit-message",
    });

    await expect(collect(stream)).resolves.toEqual([{ type: "finish" }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry permanent HTTP failures", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 202,
          headers: { "x-trigger-run-id": "run_unauthorized" },
        }),
      )
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const transport = new TriggerChatTransport({
      api: "http://localhost/api/agent",
      fetch: fetchMock,
      reconnectDelayInMs: 0,
    });

    const stream = await transport.sendMessages({
      chatId: "chat_unauthorized",
      messages: [
        {
          id: "message_unauthorized",
          role: "user",
          parts: [{ type: "text", text: "hi" }],
        },
      ],
      trigger: "submit-message",
    });

    await expect(collect(stream)).rejects.toThrow(
      "Failed to reconnect to agent: 401 unauthorized",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
