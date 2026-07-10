import {
  applyAgenticCache,
  CodingHarness,
  createCachedSystemMessage,
  type SandboxSessionOptions,
} from "@autopr/agent";
import { api } from "@autopr/backend/convex/_generated/api";
import { task } from "@trigger.dev/sdk";
import { getAuthkit } from "@workos/authkit-tanstack-react-start";
import { fetchAction, fetchMutation } from "convex/nextjs";
import { stepCountIs, streamText } from "ai";

import { compactPromptMessagesForModel } from "#/lib/agent-message-compaction";
import { responseMessagesToAssistantParts } from "#/lib/chat-messages";
import { createCodexResponsesModel } from "#/lib/codex-auth-server";
import {
  addCodexUsageCosts,
  calculateCodexUsageCost,
  emptyCodexUsageCost,
  type CodexUsageCost,
} from "#/lib/codex-models";
import {
  AGENT_TASK_ID,
  type AgentTaskOptions,
  type AgentTaskPayload,
  type WorkOSAgentAuth,
} from "#/lib/trigger-agent-contract";
import { agentUIStream } from "#/trigger/streams";

interface AssistantPersistenceOptions {
  convexAuth: WorkOSAgentAuth;
  threadId: string;
  assistantMessageId: string;
}

type AssistantTokenUsageMetadata = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  cost: CodexUsageCost;
};

interface AssistantUsageMetadata {
  usage: AssistantTokenUsageMetadata;
  contextUsage: AssistantTokenUsageMetadata;
  run: {
    startedAt: number;
    completedAt: number;
    durationSeconds: number;
  };
}

type AgentRunIssue = {
  runId: string;
  stepName?: string;
  attempt?: number;
  retryCount?: number;
  message: string;
  errorStack?: string;
  occurredAt: number;
};

const MAX_AGENT_STEPS = 100;

function getConvexUrl() {
  const url = process.env.VITE_CONVEX_URL;
  if (!url) {
    throw new Error("Missing VITE_CONVEX_URL in the Trigger.dev environment");
  }
  return url;
}

function isPersistenceUnauthenticatedError(error: unknown) {
  return error instanceof Error && error.message.includes("Unauthorized");
}

function isCancellation(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

function emptyTokenUsage(): AssistantTokenUsageMetadata {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    cost: emptyCodexUsageCost(),
  };
}

function tokenUsageFromStep(
  step: {
    usage: Omit<Partial<AssistantTokenUsageMetadata>, "cost"> & {
      inputTokenDetails?: {
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
      };
    };
  },
  modelId: string,
): AssistantTokenUsageMetadata {
  const cachedInputTokens =
    step.usage.inputTokenDetails?.cacheReadTokens ?? step.usage.cachedInputTokens ?? 0;
  const usage = {
    inputTokens: step.usage.inputTokens ?? 0,
    outputTokens: step.usage.outputTokens ?? 0,
    totalTokens: step.usage.totalTokens ?? 0,
    cachedInputTokens,
    cacheWriteTokens: step.usage.inputTokenDetails?.cacheWriteTokens ?? step.usage.cacheWriteTokens ?? 0,
  };

  return {
    ...usage,
    cost: calculateCodexUsageCost(modelId, usage),
  };
}

function addTokenUsage(
  total: AssistantTokenUsageMetadata,
  usage: AssistantTokenUsageMetadata,
): AssistantTokenUsageMetadata {
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    totalTokens: total.totalTokens + usage.totalTokens,
    cachedInputTokens: total.cachedInputTokens + usage.cachedInputTokens,
    cacheWriteTokens: total.cacheWriteTokens + usage.cacheWriteTokens,
    cost: addCodexUsageCosts(total.cost, usage.cost),
  };
}

function readRecordProperty(error: unknown, key: string): unknown {
  return typeof error === "object" && error !== null ? (error as Record<string, unknown>)[key] : undefined;
}

function readStringProperty(error: unknown, key: string): string | undefined {
  const value = readRecordProperty(error, key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumberProperty(error: unknown, key: string): number | undefined {
  const value = readRecordProperty(error, key);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNestedErrorMessage(value: unknown): string | undefined {
  const error = readRecordProperty(value, "error");
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message.length > 0 ? message : undefined;
}

function parseEmbeddedErrorMessage(message: string): string | undefined {
  const jsonStart = message.indexOf("{");
  const jsonEnd = message.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    return undefined;
  }

  try {
    return readNestedErrorMessage(JSON.parse(message.slice(jsonStart, jsonEnd + 1)));
  } catch {
    return undefined;
  }
}

function displayMessageFromError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const directNestedMessage = readNestedErrorMessage(error);
  const embeddedMessage = parseEmbeddedErrorMessage(message);
  const causeMessage = parseEmbeddedErrorMessage(String(readRecordProperty(error, "cause") ?? ""));

  return directNestedMessage ?? embeddedMessage ?? causeMessage ?? message;
}

function agentRunIssueFromError(error: unknown, runId: string, attempt: number): AgentRunIssue {
  return {
    runId,
    stepName: readStringProperty(error, "stepName"),
    attempt: readNumberProperty(error, "attempt") ?? attempt,
    retryCount: readNumberProperty(error, "retryCount") ?? Math.max(0, attempt - 1),
    message: displayMessageFromError(error),
    errorStack: error instanceof Error ? error.stack : undefined,
    occurredAt: Date.now(),
  };
}

async function refreshWorkOSConvexAuth(convexAuth: WorkOSAgentAuth) {
  const authkit = await getAuthkit();
  const { auth } = await authkit.refreshSession({
    accessToken: convexAuth.accessToken,
    refreshToken: convexAuth.refreshToken,
    user: convexAuth.user,
    impersonator: convexAuth.impersonator,
  });

  if (!auth.user) {
    throw new Error("Unauthorized");
  }

  return {
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    user: auth.user,
    impersonator: auth.impersonator,
  } satisfies WorkOSAgentAuth;
}

async function patchAssistantMessage({
  convexAuth,
  threadId,
  assistantMessageId,
  parts,
  metadata,
}: AssistantPersistenceOptions & {
  parts: unknown[];
  metadata?: AssistantUsageMetadata;
}) {
  await fetchAction(
    api.messages.patchAssistant,
    { threadId, assistantMessageId, parts, metadata },
    { token: convexAuth.accessToken, url: getConvexUrl() },
  );
}

async function markAgentRunFinished({
  convexAuth,
  threadId,
  runId,
}: Pick<AssistantPersistenceOptions, "convexAuth" | "threadId"> & {
  runId: string;
}) {
  await fetchMutation(
    api.threads.markRunFinished,
    { threadId, runId },
    { token: convexAuth.accessToken, url: getConvexUrl() },
  );
}

async function recordAgentRunIssue({
  convexAuth,
  threadId,
  issue,
}: Pick<AssistantPersistenceOptions, "convexAuth" | "threadId"> & {
  issue: AgentRunIssue;
}) {
  await fetchMutation(
    api.threads.recordAgentRunIssue,
    { threadId, issue },
    { token: convexAuth.accessToken, url: getConvexUrl() },
  );
}

function getAssistantPersistenceOptions(options: AgentTaskOptions): AssistantPersistenceOptions | null {
  if (!options.convexAuth || !options.threadId || !options.assistantMessageId) {
    return null;
  }

  return {
    convexAuth: options.convexAuth,
    threadId: options.threadId,
    assistantMessageId: options.assistantMessageId,
  };
}

function codexPromptCacheKey(options: AgentTaskOptions) {
  const source = options.threadId ?? options.sandboxCacheKey;
  const stableSegment = source.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);

  return `autopr-${stableSegment}`;
}

async function reportAgentFailure(
  options: AgentTaskOptions,
  error: unknown,
  runId: string,
  attempt: number,
) {
  const persistence = getAssistantPersistenceOptions(options);
  if (!persistence) {
    return false;
  }

  try {
    const refreshedPersistence = {
      ...persistence,
      convexAuth: await refreshWorkOSConvexAuth(persistence.convexAuth),
    };
    await recordAgentRunIssue({
      convexAuth: refreshedPersistence.convexAuth,
      threadId: refreshedPersistence.threadId,
      issue: agentRunIssueFromError(error, runId, attempt),
    });
    return true;
  } catch (recordError) {
    if (!isPersistenceUnauthenticatedError(recordError)) {
      console.error("Failed to record agent run issue", recordError);
    }
    return false;
  }
}

async function finishCancelledAgentRun(options: AgentTaskOptions, runId: string) {
  const persistence = getAssistantPersistenceOptions(options);
  const [streamResult, persistenceResult] = await Promise.allSettled([
    agentUIStream.append({ type: "finish" }),
    persistence
      ? refreshWorkOSConvexAuth(persistence.convexAuth).then((convexAuth) =>
          markAgentRunFinished({
            convexAuth,
            threadId: persistence.threadId,
            runId,
          }),
        )
      : Promise.resolve(),
  ]);

  if (streamResult.status === "rejected") {
    console.error("Failed to close cancelled assistant stream", streamResult.reason);
  }

  if (
    persistenceResult.status === "rejected" &&
    !isPersistenceUnauthenticatedError(persistenceResult.reason)
  ) {
    console.error("Failed to mark cancelled agent run as finished", persistenceResult.reason);
  }
}

async function runAgentTask(
  { messages: inputMessages, options }: AgentTaskPayload,
  runId: string,
  attempt: number,
  signal: AbortSignal,
) {
  const persistence = getAssistantPersistenceOptions(options);
  const sandboxOptions: SandboxSessionOptions = {
    cacheKey: options.sandboxCacheKey,
    sandboxId: options.sandboxId,
    workDir: options.sandboxWorkDir,
    repoUrl: options.repoUrl,
    repoBranch: options.repoBranch,
    repoName: options.repoName,
    runId,
  };
  const demoRecordingEnabled = Boolean(options.demoEnabled && options.projectId && options.threadId);
  const harness = new CodingHarness({
    ...sandboxOptions,
    computer: demoRecordingEnabled ? {} : false,
    modelId: options.codex.modelId,
    appendSystemPrompt: [
      "This chat is streamed through a durable Trigger.dev task. The Daytona sandbox is created before you answer and all tools operate inside that sandbox.",
      options.repoUrl ? `Repository: ${options.repoUrl}` : undefined,
      options.repoBranch ? `Repository branch: ${options.repoBranch}` : undefined,
      options.sandboxWorkDir ? `Sandbox working directory: ${options.sandboxWorkDir}` : undefined,
      options.projectId ? `Project ID: ${options.projectId}` : undefined,
      options.threadId ? `Thread ID: ${options.threadId}` : undefined,
      demoRecordingEnabled
        ? "Demo mode is enabled for this thread. After completing the requested work, use the computer tool inside Daytona to open the browser preview in Google Chrome and record a concise final demo video. Start recording only after the app is ready and the demo path is clear; give start_recording and stop_recording the same concise descriptive title for the final embedded video. Stop recording promptly. The chat UI embeds the recording automatically from tool output; do not print raw recording URLs, IDs, file paths, or metadata unless the user explicitly asks for them. Skip this only if no meaningful browser preview is possible, and explain the concrete blocker."
        : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
  });
  const codexOptions = {
    ...options.codex,
    promptCacheKey: options.codex.promptCacheKey ?? codexPromptCacheKey(options),
  };
  let persistenceFinished = false;
  let streamFinished = false;
  const runStartedAt = Date.now();

  if (options.assistantMessageId) {
    await agentUIStream.append({
      type: "start",
      messageId: options.assistantMessageId,
    });
  }

  try {
    await harness.run(async ({ instructions, tools }) => {
      const model = await createCodexResponsesModel(codexOptions);
      const result = streamText({
        model,
        system: createCachedSystemMessage(instructions),
        messages: applyAgenticCache(inputMessages),
        tools,
        toolChoice: "auto",
        stopWhen: stepCountIs(MAX_AGENT_STEPS),
        maxRetries: 1,
        abortSignal: signal,
        prepareStep: ({ messages }) => ({
          messages: compactPromptMessagesForModel(messages),
        }),
        providerOptions: {
          openai: {
            store: false,
            instructions,
            parallelToolCalls: true,
            promptCacheKey: codexOptions.promptCacheKey,
            reasoningEffort: codexOptions.reasoningEffort,
            reasoningSummary: "auto",
            include: ["reasoning.encrypted_content"],
          },
        },
      });
      const streamed = agentUIStream.pipe(
        result.toUIMessageStream({
          sendStart: !options.assistantMessageId,
          sendFinish: false,
        }),
        { signal },
      );

      await streamed.waitUntilComplete();

      const [steps, response] = await Promise.all([result.steps, result.response]);
      const stepUsages = steps.map((step) => tokenUsageFromStep(step, codexOptions.modelId));
      const runCompletedAt = Date.now();
      const usageMetadata: AssistantUsageMetadata = {
        usage: stepUsages.reduce(addTokenUsage, emptyTokenUsage()),
        contextUsage: stepUsages.at(-1) ?? emptyTokenUsage(),
        run: {
          startedAt: runStartedAt,
          completedAt: runCompletedAt,
          durationSeconds: Math.max(0, Math.round((runCompletedAt - runStartedAt) / 1000)),
        },
      };

      await agentUIStream.append({
        type: "message-metadata",
        messageMetadata: usageMetadata,
      });
      await agentUIStream.append({ type: "finish" });
      streamFinished = true;

      if (!persistence) {
        return;
      }

      try {
        const refreshedPersistence = {
          ...persistence,
          convexAuth: await refreshWorkOSConvexAuth(persistence.convexAuth),
        };
        await patchAssistantMessage({
          ...refreshedPersistence,
          parts: responseMessagesToAssistantParts(
            [...inputMessages, ...response.messages],
            inputMessages.length,
          ),
          metadata: usageMetadata,
        });
        await markAgentRunFinished({
          convexAuth: refreshedPersistence.convexAuth,
          threadId: refreshedPersistence.threadId,
          runId,
        });
        persistenceFinished = true;
      } catch (error) {
        if (!isPersistenceUnauthenticatedError(error)) {
          throw error;
        }
      }
    });
  } catch (error) {
    if (persistence && !isCancellation(error, signal)) {
      persistenceFinished = await reportAgentFailure(options, error, runId, attempt);
    }

    throw error;
  } finally {
    if (!streamFinished && !signal.aborted) {
      try {
        await agentUIStream.append({ type: "finish" });
        streamFinished = true;
      } catch (error) {
        console.error("Failed to close assistant stream", error);
      }
    }

    if (persistence && !persistenceFinished) {
      try {
        const refreshedPersistence = {
          ...persistence,
          convexAuth: await refreshWorkOSConvexAuth(persistence.convexAuth),
        };
        await markAgentRunFinished({
          convexAuth: refreshedPersistence.convexAuth,
          threadId: refreshedPersistence.threadId,
          runId,
        });
      } catch (error) {
        if (!isPersistenceUnauthenticatedError(error) && !signal.aborted) {
          throw error;
        }
      }
    }
  }
}

export const agentTask = task<typeof AGENT_TASK_ID, AgentTaskPayload, { ok: true }>({
  id: AGENT_TASK_ID,
  machine: "small-1x",
  retry: {
    // Retrying an LLM stream would replay already delivered UI chunks. The AI
    // provider still retries transient requests, while the write tool carries
    // its own persistent idempotency guarantee.
    maxAttempts: 1,
  },
  onFailure: async ({ payload, error, ctx, signal }) => {
    // Trigger.dev 4.5.2 can reach onFailure after its cancellation signal
    // aborts task code. A user-requested stop must not become a run issue.
    if (isCancellation(error, signal)) {
      return;
    }

    await reportAgentFailure(payload.options, error, ctx.run.id, ctx.attempt.number);
  },
  onCancel: async ({ payload, ctx }) => {
    // Trigger waits for onCancel hooks (within its cancellation timeout),
    // making this more reliable than depending on task finally blocks while
    // the managed worker is being torn down.
    await finishCancelledAgentRun(payload.options, ctx.run.id);
  },
  run: async (payload: AgentTaskPayload, { ctx, signal }) => {
    await runAgentTask(payload, ctx.run.id, ctx.attempt.number, signal);
    return { ok: true as const };
  },
});
