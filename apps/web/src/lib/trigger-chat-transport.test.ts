import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";

import { TriggerChatTransport } from "./trigger-chat-transport";

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
});
