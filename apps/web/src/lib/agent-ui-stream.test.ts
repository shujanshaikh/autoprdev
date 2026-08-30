import { describe, expect, it } from "vitest";
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
    );

    await expect(collect(stream)).resolves.toEqual([
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Done." },
      { type: "text-end", id: "text-1" },
      { type: "message-metadata", messageMetadata: metadata },
      { type: "finish" },
    ]);
  });
});
