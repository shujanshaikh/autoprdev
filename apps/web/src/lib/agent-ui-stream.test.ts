import { describe, expect, it, vi } from "vitest";
import type { UIMessageChunk } from "ai";

import { createAssistantUsageMetadata } from "#/lib/agent-usage";
import { finalizeAgentUIMessageStream } from "./agent-ui-stream";

function chunkStream(chunks: UIMessageChunk[]) {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<UIMessageChunk>) {
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return chunks;
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
}

describe("agent UI stream finalization", () => {
  it("keeps final metadata and one finish marker in the source stream", async () => {
    const metadata = createAssistantUsageMetadata([], "gpt-test", 1, 2);
    const stream = finalizeAgentUIMessageStream(
      chunkStream([
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "Done." },
        { type: "text-end", id: "text-1" },
        { type: "finish" },
      ]),
      async () => metadata,
      async () => {},
    );

    await expect(collect(stream)).resolves.toEqual([
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Done." },
      { type: "text-end", id: "text-1" },
      { type: "message-metadata", messageMetadata: metadata },
      { type: "finish" },
    ]);
  });

  it("streams the reply immediately but withholds finish until it is persisted", async () => {
    const metadata = createAssistantUsageMetadata([], "gpt-test", 1, 2);
    let resolvePersistence!: () => void;
    const persistence = new Promise<void>((resolve) => {
      resolvePersistence = resolve;
    });
    const persistResponse = vi.fn(() => persistence);
    const reader = finalizeAgentUIMessageStream(
      chunkStream([
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "Saved reply" },
        { type: "text-end", id: "text-1" },
        { type: "finish" },
      ]),
      async () => metadata,
      persistResponse,
    ).getReader();

    expect((await reader.read()).value).toEqual({ type: "text-start", id: "text-1" });
    expect((await reader.read()).value).toEqual({
      type: "text-delta", id: "text-1", delta: "Saved reply",
    });
    expect((await reader.read()).value).toEqual({ type: "text-end", id: "text-1" });
    expect((await reader.read()).value).toEqual({
      type: "message-metadata", messageMetadata: metadata,
    });
    expect(persistResponse).toHaveBeenCalledExactlyOnceWith(metadata);

    const onFinish = vi.fn();
    const finish = reader.read().then(onFinish);
    await Promise.resolve();
    expect(onFinish).not.toHaveBeenCalled();

    resolvePersistence();
    await finish;
    expect(onFinish).toHaveBeenCalledWith({ done: false, value: { type: "finish" } });
    expect((await reader.read()).done).toBe(true);
    reader.releaseLock();
  });

  it("propagates persistence failures without announcing successful completion", async () => {
    const error = new Error("Persistence unavailable");
    const chunks: UIMessageChunk[] = [];
    const stream = finalizeAgentUIMessageStream(
      chunkStream([{ type: "finish" }]),
      async () => createAssistantUsageMetadata([], "gpt-test", 1, 2),
      async () => { throw error; },
    );
    const read = async () => {
      const reader = stream.getReader();
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) return;
          chunks.push(result.value);
        }
      } finally {
        reader.releaseLock();
      }
    };

    await expect(read()).rejects.toBe(error);
    expect(chunks.some((chunk) => chunk.type === "finish")).toBe(false);
  });
});
