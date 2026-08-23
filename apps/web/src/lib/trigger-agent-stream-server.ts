import "@tanstack/react-start/server-only";

import type { UIMessageChunk } from "ai";

import { retrieveTriggerAgentRun, type TriggerAgentRun } from "#/lib/trigger-agent-run-server";
import { agentUIStream } from "#/trigger/streams";

const REALTIME_REQUEST_TIMEOUT_SECONDS = 55;
const TRIGGER_RUN_VISIBILITY_GRACE_MS = 30_000;

export function isTriggerRunVisibilityPending(
  thread: { currentRunId?: string; updatedAt: number },
  runId: string,
  now = Date.now(),
) {
  return thread.currentRunId === runId
    && now - thread.updatedAt < TRIGGER_RUN_VISIBILITY_GRACE_MS;
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

export function ensureTerminalRunFinishes(
  stream: ReadableStream<UIMessageChunk> & AsyncIterable<UIMessageChunk>,
  runId: string,
  onTerminal?: (run: TriggerAgentRun | null) => void | Promise<void>,
  retrieveRun: (runId: string) => Promise<TriggerAgentRun | null> = retrieveTriggerAgentRun,
) {
  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      let gotFinish = false;

      try {
        for await (const chunk of stream) {
          if (chunk.type === "finish" && !gotFinish) {
            // The app-level finish chunk is authoritative even though the
            // Trigger task may still be completing its final persistence
            // step. Settle Convex before exposing finish to clients so every
            // connected surface leaves its live state at the same boundary.
            await onTerminal?.(null);
            gotFinish = true;
          }
          controller.enqueue(chunk);
          if (gotFinish) {
            // Trigger realtime reads can remain open until their request
            // timeout even after the app stream has emitted finish. Breaking
            // here cancels that upstream read and closes the HTTP response now.
            break;
          }
        }

        if (!gotFinish) {
          const run = await retrieveRun(runId);
          if (!run || run.isCompleted) {
            await onTerminal?.(run);
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
  onTerminal?: (run: TriggerAgentRun | null) => void | Promise<void>,
) {
  const stream = await agentUIStream.read(runId, {
    startIndex,
    timeoutInSeconds: REALTIME_REQUEST_TIMEOUT_SECONDS,
    signal,
  });

  return ensureTerminalRunFinishes(stream, runId, onTerminal);
}
