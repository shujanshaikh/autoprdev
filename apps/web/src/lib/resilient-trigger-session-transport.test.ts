import { readUIMessageStream, type ChatTransport, type UIMessage, type UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";

import {
  isRetryableTriggerSessionStreamError,
  ResilientTriggerSessionTransport,
} from "./resilient-trigger-session-transport";

function streamThenFail(chunks: UIMessageChunk[], error: Error) {
  let index = 0;
  return new ReadableStream<UIMessageChunk>({
    pull(controller) {
      const chunk = chunks[index];
      if (chunk) {
        index += 1;
        controller.enqueue(chunk);
      } else {
        controller.error(error);
      }
    },
  });
}

function chunkStream(chunks: UIMessageChunk[], onClose?: () => void) {
  let index = 0;
  return new ReadableStream<UIMessageChunk>({
    pull(controller) {
      const chunk = chunks[index];
      if (chunk) {
        index += 1;
        controller.enqueue(chunk);
      } else {
        onClose?.();
        controller.close();
      }
    },
  });
}

async function collect(stream: ReadableStream<UIMessageChunk>) {
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        return chunks;
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
}

async function collectMessages(stream: ReadableStream<UIMessageChunk>) {
  const messages: UIMessage[] = [];
  const reader = readUIMessageStream({ stream, terminateOnError: true }).getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        return messages;
      }
      messages.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
}

function sendOptions() {
  return {
    trigger: "submit-message" as const,
    chatId: "thread_1",
    messageId: undefined,
    messages: [{ id: "user_1", role: "user" as const, parts: [] }],
    abortSignal: undefined,
  };
}

function mockSessionTransport(options: {
  initial: ReadableStream<UIMessageChunk>;
  reconnect: () => Promise<ReadableStream<UIMessageChunk> | null>;
  isStreaming: () => boolean;
}) {
  return {
    sendMessages: vi.fn(async () => options.initial),
    reconnectToStream: vi.fn(options.reconnect),
    getSession: vi.fn(() => ({ isStreaming: options.isStreaming() })),
  } satisfies ChatTransport<UIMessage> & {
    getSession(chatId: string): { isStreaming?: boolean } | undefined;
  };
}

describe("ResilientTriggerSessionTransport", () => {
  it("keeps text part state in one logical stream across a fetch failure", async () => {
    let isStreaming = true;
    const initial = streamThenFail([
      { type: "text-start", id: "text_1" },
      { type: "text-delta", id: "text_1", delta: "Hello " },
    ], new TypeError("fetch failed"));
    const resumedChunks: UIMessageChunk[] = [
      { type: "text-delta", id: "text_1", delta: "world" },
      { type: "text-end", id: "text_1" },
    ];
    const delegate = mockSessionTransport({
      initial,
      reconnect: async () => chunkStream(resumedChunks, () => {
        isStreaming = false;
      }),
      isStreaming: () => isStreaming,
    });
    const transport = new ResilientTriggerSessionTransport(delegate, {
      reconnectDelayInMs: 0,
    });

    const [rawStream, parsedStream] = (await transport.sendMessages(sendOptions())).tee();
    await expect(collect(rawStream)).resolves.toEqual([
      { type: "text-start", id: "text_1" },
      { type: "text-delta", id: "text_1", delta: "Hello " },
      { type: "text-delta", id: "text_1", delta: "world" },
      { type: "text-end", id: "text_1" },
    ]);
    const parsedMessages = await collectMessages(parsedStream);
    expect(parsedMessages.at(-1)?.parts).toEqual([
      { type: "text", text: "Hello world", state: "done", providerMetadata: undefined },
    ]);
    expect(delegate.reconnectToStream).toHaveBeenCalledOnce();
  });

  it("reconnects when a live session stream closes without an error", async () => {
    let isStreaming = true;
    const delegate = mockSessionTransport({
      initial: chunkStream([{ type: "start", messageId: "assistant_1" }]),
      reconnect: async () => chunkStream([{ type: "finish" }], () => {
        isStreaming = false;
      }),
      isStreaming: () => isStreaming,
    });
    const transport = new ResilientTriggerSessionTransport(delegate, {
      reconnectDelayInMs: 0,
    });

    await expect(collect(await transport.sendMessages(sendOptions()))).resolves.toEqual([
      { type: "start", messageId: "assistant_1" },
      { type: "finish" },
    ]);
    expect(delegate.reconnectToStream).toHaveBeenCalledOnce();
  });

  it("does not reconnect after a completed session closes", async () => {
    const delegate = mockSessionTransport({
      initial: chunkStream([{ type: "finish" }]),
      reconnect: async () => null,
      isStreaming: () => false,
    });
    const transport = new ResilientTriggerSessionTransport(delegate, {
      reconnectDelayInMs: 0,
    });

    await expect(collect(await transport.sendMessages(sendOptions()))).resolves.toEqual([
      { type: "finish" },
    ]);
    expect(delegate.reconnectToStream).not.toHaveBeenCalled();
  });

  it("surfaces permanent stream failures without reconnecting", async () => {
    const permanentError = Object.assign(new Error("unauthorized"), { status: 401 });
    const delegate = mockSessionTransport({
      initial: streamThenFail([], permanentError),
      reconnect: async () => null,
      isStreaming: () => true,
    });
    const transport = new ResilientTriggerSessionTransport(delegate, {
      reconnectDelayInMs: 0,
    });

    await expect(collect(await transport.sendMessages(sendOptions()))).rejects.toThrow(
      "unauthorized",
    );
    expect(delegate.reconnectToStream).not.toHaveBeenCalled();
  });
});

describe("isRetryableTriggerSessionStreamError", () => {
  it("recognizes transient browser and HTTP transport failures", () => {
    expect(isRetryableTriggerSessionStreamError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableTriggerSessionStreamError(Object.assign(new Error("busy"), { status: 503 })))
      .toBe(true);
    expect(isRetryableTriggerSessionStreamError(Object.assign(new Error("denied"), { status: 403 })))
      .toBe(false);
  });
});
