import "@tanstack/react-start/server-only";

import { api } from "@autopr/backend/convex/_generated/api";
import { runs, type AnyRetrieveRunResult } from "@trigger.dev/sdk";

import { convexMutation } from "#/lib/convex-server";
import { AGENT_TASK_ID } from "#/lib/trigger-agent-contract";
import { triggerRunFailureMessage } from "#/lib/trigger-run-error";

export type TriggerAgentRun = AnyRetrieveRunResult;

export type TriggerAgentRunLookup =
  | { status: "found"; run: TriggerAgentRun }
  | { status: "not-found" }
  | { status: "mismatch" };

export function isTriggerNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 404
  );
}

export async function retrieveTriggerAgentRun(runId: string) {
  const run = await runs.retrieve(runId).catch((error: unknown) => {
    if (isTriggerNotFoundError(error)) {
      return null;
    }

    throw error;
  });

  return run;
}

export async function lookupTriggerAgentRun(
  runId: string,
  requiredTags: readonly string[],
): Promise<TriggerAgentRunLookup> {
  const run = await retrieveTriggerAgentRun(runId);

  if (!run) {
    return { status: "not-found" };
  }

  if (
    run.taskIdentifier !== AGENT_TASK_ID ||
    requiredTags.some((tag) => !run.tags.includes(tag))
  ) {
    return { status: "mismatch" };
  }

  return { status: "found", run };
}

export async function reconcileThreadWithTriggerRun(
  threadId: string,
  runId: string,
  run: TriggerAgentRun | null,
) {
  // Trigger marks CANCELED as both completed and failed. Cancellation is a
  // user-controlled terminal state, not an agent failure to surface.
  if (run?.isFailed && !run.isCancelled) {
    await convexMutation(api.threads.recordAgentRunIssue, {
      threadId,
      issue: {
        runId,
        attempt: run.attemptCount > 0 ? run.attemptCount : undefined,
        retryCount: run.attemptCount > 0 ? Math.max(0, run.attemptCount - 1) : undefined,
        message: triggerRunFailureMessage(run.error),
        errorStack: run.error?.stackTrace,
        occurredAt: run.finishedAt?.getTime() ?? Date.now(),
      },
    });
    return;
  }

  await convexMutation(api.threads.markRunFinished, {
    threadId,
    runId,
  });
}
