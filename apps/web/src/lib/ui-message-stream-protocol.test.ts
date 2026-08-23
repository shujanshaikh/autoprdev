import {
  readUIMessageStream,
  type ChatTransport,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { describe, expect, it } from "vitest";

import {
  repairUIMessageStreamProtocol,
  UIMessageStreamProtocolTransport,
} from "./ui-message-stream-protocol";

function chunkStream(chunks: UIMessageChunk[]) {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<UIMessageChunk>) {
  return await Array.fromAsync(stream);
}

async function collectMessages(stream: ReadableStream<UIMessageChunk>) {
  return await Array.fromAsync(readUIMessageStream({ stream, terminateOnError: true }));
}

describe("repairUIMessageStreamProtocol", () => {
  it("leaves a valid text lifecycle unchanged", async () => {
    const chunks: UIMessageChunk[] = [
      { type: "text-start", id: "text_1" },
      { type: "text-delta", id: "text_1", delta: "Complete" },
      { type: "text-end", id: "text_1" },
      { type: "finish" },
    ];

    await expect(collect(repairUIMessageStreamProtocol(chunkStream(chunks))))
      .resolves.toEqual(chunks);
  });

  it("keeps a text part open for a final delta delivered after text-end", async () => {
    const repaired = repairUIMessageStreamProtocol(chunkStream([
      { type: "text-start", id: "msg_1" },
      { type: "text-delta", id: "msg_1", delta: "Saved " },
      { type: "text-end", id: "msg_1" },
      { type: "text-delta", id: "msg_1", delta: "properly" },
      { type: "text-end", id: "msg_1" },
      { type: "finish" },
    ]));

    const messages = await collectMessages(repaired);
    expect(messages.at(-1)?.parts).toEqual([
      {
        type: "text",
        text: "Saved properly",
        state: "done",
        providerMetadata: undefined,
      },
    ] satisfies UIMessage["parts"]);
  });

  it("reuses the pending text-end when no replacement arrives after a late delta", async () => {
    const repaired = repairUIMessageStreamProtocol(chunkStream([
      { type: "text-start", id: "msg_1" },
      { type: "text-delta", id: "msg_1", delta: "Saved " },
      { type: "text-end", id: "msg_1" },
      { type: "text-delta", id: "msg_1", delta: "properly" },
      { type: "finish" },
    ]));

    await expect(collect(repaired)).resolves.toEqual([
      { type: "text-start", id: "msg_1" },
      { type: "text-delta", id: "msg_1", delta: "Saved " },
      { type: "text-delta", id: "msg_1", delta: "properly" },
      { type: "text-end", id: "msg_1" },
      { type: "finish" },
    ]);
  });

  it("starts a text part when a durable resume begins with a delta", async () => {
    const repaired = repairUIMessageStreamProtocol(chunkStream([
      { type: "text-delta", id: "msg_resumed", delta: "Resumed" },
      { type: "text-end", id: "msg_resumed" },
      { type: "finish" },
    ]));

    await expect(collect(repaired)).resolves.toEqual([
      { type: "text-start", id: "msg_resumed" },
      { type: "text-delta", id: "msg_resumed", delta: "Resumed" },
      { type: "text-end", id: "msg_resumed" },
      { type: "finish" },
    ]);
  });

  it("closes another pending text part before starting a resumed delta", async () => {
    const repaired = repairUIMessageStreamProtocol(chunkStream([
      { type: "text-start", id: "msg_a" },
      { type: "text-delta", id: "msg_a", delta: "First" },
      { type: "text-end", id: "msg_a" },
      { type: "text-delta", id: "msg_b", delta: "Second" },
      { type: "text-end", id: "msg_b" },
      { type: "finish" },
    ]));

    await expect(collect(repaired)).resolves.toEqual([
      { type: "text-start", id: "msg_a" },
      { type: "text-delta", id: "msg_a", delta: "First" },
      { type: "text-end", id: "msg_a" },
      { type: "text-start", id: "msg_b" },
      { type: "text-delta", id: "msg_b", delta: "Second" },
      { type: "text-end", id: "msg_b" },
      { type: "finish" },
    ]);
  });

  it("repairs malformed chunks returned by a transport send", async () => {
    const source: ChatTransport<UIMessage> = {
      sendMessages: async () => chunkStream([
        { type: "text-delta", id: "msg_task", delta: "Finished" },
        { type: "text-end", id: "msg_task" },
        { type: "finish" },
      ]),
      reconnectToStream: async () => null,
    };
    const transport = new UIMessageStreamProtocolTransport(source);

    const repaired = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "thread_1",
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
    });

    await expect(collect(repaired)).resolves.toEqual([
      { type: "text-start", id: "msg_task" },
      { type: "text-delta", id: "msg_task", delta: "Finished" },
      { type: "text-end", id: "msg_task" },
      { type: "finish" },
    ]);
  });
});
