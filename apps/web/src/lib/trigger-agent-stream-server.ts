import "@tanstack/react-start/server-only";

import type { UIMessageChunk } from "ai";

import {
  retrieveTriggerAgentRun,
  type TriggerAgentRun,
} from "#/lib/trigger-agent-run-server";
import { agentUIStream } from "#/trigger/streams";

const REALTIME_REQUEST_TIMEOUT_SECONDS = 55;

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
  onTerminalWithoutFinish?: (run: TriggerAgentRun | null) => void | Promise<void>,
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
          const run = await retrieveTriggerAgentRun(runId);
          if (!run || run.isCompleted) {
            await onTerminalWithoutFinish?.(run);
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
  onTerminalWithoutFinish?: (run: TriggerAgentRun | null) => void | Promise<void>,
) {
  const stream = await agentUIStream.read(runId, {
    startIndex,
    timeoutInSeconds: REALTIME_REQUEST_TIMEOUT_SECONDS,
    signal,
  });

  return ensureTerminalRunFinishes(stream, runId, onTerminalWithoutFinish);
}
