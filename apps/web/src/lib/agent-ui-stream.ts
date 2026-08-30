import type { UIMessageChunk } from "ai";

import type { AssistantUsageMetadata } from "#/lib/agent-usage";

/**
 * Keeps metadata and finish in the same ordered realtime stream as the model output.
 * A source finish is replaced so the terminal marker always follows final metadata.
 */
export function finalizeAgentUIMessageStream(
  stream: ReadableStream<UIMessageChunk>,
  getMetadata: () => AssistantUsageMetadata | Promise<AssistantUsageMetadata>,
) {
  return stream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      if (chunk.type !== "finish") {
        controller.enqueue(chunk);
      }
    },
    async flush(controller) {
      controller.enqueue({
        type: "message-metadata",
        messageMetadata: await getMetadata(),
      });
      controller.enqueue({ type: "finish" });
    },
  }));
}
