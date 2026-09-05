import type { UIMessageChunk } from "ai";

import type { AssistantUsageMetadata } from "#/lib/agent-usage";

/**
 * Keeps metadata and finish in the same ordered realtime stream as the model output.
 * A source finish is replaced so the terminal marker follows final metadata and
 * persistence. Readers may settle the run as soon as they receive that marker.
 */
export function finalizeAgentUIMessageStream(
  stream: ReadableStream<UIMessageChunk>,
  getMetadata: () => AssistantUsageMetadata | Promise<AssistantUsageMetadata>,
  persistResponse: (metadata: AssistantUsageMetadata) => Promise<void>,
) {
  return stream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      if (chunk.type !== "finish") {
        controller.enqueue(chunk);
      }
    },
    async flush(controller) {
      const metadata = await getMetadata();
      controller.enqueue({
        type: "message-metadata",
        messageMetadata: metadata,
      });
      await persistResponse(metadata);
      controller.enqueue({ type: "finish" });
    },
  }));
}
