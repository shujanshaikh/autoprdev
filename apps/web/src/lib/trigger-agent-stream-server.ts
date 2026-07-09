import "@tanstack/react-start/server-only";

import { runs } from "@trigger.dev/sdk";
import type { UIMessageChunk } from "ai";

import { agentUIStream } from "#/trigger/streams";

const REALTIME_REQUEST_TIMEOUT_SECONDS = 55;

export function isTriggerNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 404
  );
}

export function finishedUIMessageStream() {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: "finish" });
      controller.close();
    },
  });
}

export function emptyUIMessageStream() {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.close();
    },
  });
}

function ensureTerminalRunFinishes(
  stream: ReadableStream<UIMessageChunk> & AsyncIterable<UIMessageChunk>,
  runId: string,
  onTerminalWithoutFinish?: () => void | Promise<void>,
) {
  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      let gotFinish = false;

      try {
        for await (const chunk of stream) {
          gotFinish ||= chunk.type === "finish";
          controller.enqueue(chunk);
        }

        if (!gotFinish) {
          const run = await runs.retrieve(runId).catch((error: unknown) => {
            if (isTriggerNotFoundError(error)) {
              return null;
            }
            throw error;
          });
          if (!run || run.isCompleted) {
            await onTerminalWithoutFinish?.();
            controller.enqueue({ type: "finish" });
          }
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return stream.cancel(reason);
    },
  });
}

export async function readAgentUIMessageStream(
  runId: string,
  startIndex: number,
  signal: AbortSignal,
  onTerminalWithoutFinish?: () => void | Promise<void>,
) {
  const stream = await agentUIStream.read(runId, {
    startIndex,
    timeoutInSeconds: REALTIME_REQUEST_TIMEOUT_SECONDS,
    signal,
  });

  return ensureTerminalRunFinishes(stream, runId, onTerminalWithoutFinish);
}
