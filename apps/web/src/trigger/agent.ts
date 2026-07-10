import {
  applyAgenticCache,
  CodingHarness,
  createCachedSystemMessage,
  type SandboxSessionOptions,
} from "@autopr/agent";
import { api } from "@autopr/backend/convex/_generated/api";
import { task } from "@trigger.dev/sdk";
import { fetchAction } from "convex/nextjs";
import { stepCountIs, streamText, wrapLanguageModel } from "ai";

import {
  createAgentContextCompactor,
  createContextOverflowRecoveryMiddleware,
} from "#/lib/agent-context-compaction";
import {
  createAssistantUsageMetadata,
  type AssistantUsageMetadata,
} from "#/lib/agent-usage";
import {
  agentRunIssueFromError,
  type AgentRunIssue,
} from "#/lib/agent-run-issue";
import { responseMessagesToAssistantParts } from "#/lib/chat-messages";
import { createCodexResponsesModel } from "#/lib/codex-auth-server";
import { getCodexContextLimit } from "#/lib/codex-models";
import {
  AGENT_TASK_ID,
  type AgentTaskOptions,
  type AgentTaskPayload,
} from "#/lib/trigger-agent-contract";
import { agentUIStream } from "#/trigger/streams";

interface AssistantPersistenceOptions {
  persistenceToken: string;
  threadId: string;
  assistantMessageId: string;
}

const MAX_AGENT_STEPS = 100;

function getConvexUrl() {
  const url = process.env.VITE_CONVEX_URL;
  if (!url) {
    throw new Error("Missing VITE_CONVEX_URL in the Trigger.dev environment");
  }
  return url;
}

function isPersistenceUnauthenticatedError(error: unknown) {
  return error instanceof Error && /unauthorized/i.test(error.message);
}

function isCancellation(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

async function patchAssistantMessage({
  persistenceToken,
  threadId,
  assistantMessageId,
  parts,
  metadata,
}: AssistantPersistenceOptions & {
  parts: unknown[];
  metadata?: AssistantUsageMetadata;
}) {
  await fetchAction(
    api.messages.patchAssistantFromAgent,
    { threadId, assistantMessageId, persistenceToken, parts, metadata },
    { url: getConvexUrl() },
  );
}

async function markAgentRunFinished({
  persistenceToken,
  threadId,
  assistantMessageId,
  runId,
}: AssistantPersistenceOptions & {
  runId: string;
}) {
  await fetchAction(
    api.threads.markRunFinishedFromAgent,
    { threadId, assistantMessageId, persistenceToken, runId },
    { url: getConvexUrl() },
  );
}

async function recordAgentRunIssue({
  persistenceToken,
  threadId,
  assistantMessageId,
  issue,
}: AssistantPersistenceOptions & {
  issue: AgentRunIssue;
}) {
  await fetchAction(
    api.threads.recordAgentRunIssueFromAgent,
    { threadId, assistantMessageId, persistenceToken, issue },
    { url: getConvexUrl() },
  );
}

function getAssistantPersistenceOptions(options: AgentTaskOptions): AssistantPersistenceOptions | null {
  if (!options.persistenceToken || !options.threadId || !options.assistantMessageId) {
    return null;
  }

  return {
    persistenceToken: options.persistenceToken,
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
    await recordAgentRunIssue({
      ...persistence,
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
      ? markAgentRunFinished({
          ...persistence,
          runId,
        })
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
      const model = wrapLanguageModel({
        model: await createCodexResponsesModel(codexOptions),
        middleware: createContextOverflowRecoveryMiddleware(),
      });
      const result = streamText({
        model,
        system: createCachedSystemMessage(instructions),
        messages: applyAgenticCache(inputMessages),
        tools,
        toolChoice: "auto",
        stopWhen: stepCountIs(MAX_AGENT_STEPS),
        maxRetries: 1,
        abortSignal: signal,
        prepareStep: createAgentContextCompactor({
          contextWindow: getCodexContextLimit(codexOptions.modelId),
          systemPrompt: instructions,
          abortSignal: signal,
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
      const runCompletedAt = Date.now();
      const usageMetadata = createAssistantUsageMetadata(
        steps,
        codexOptions.modelId,
        runStartedAt,
        runCompletedAt,
      );

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
        await patchAssistantMessage({
          ...persistence,
          parts: responseMessagesToAssistantParts(
            [...inputMessages, ...response.messages],
            inputMessages.length,
          ),
          metadata: usageMetadata,
        });
        await markAgentRunFinished({
          ...persistence,
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
        await markAgentRunFinished({
          ...persistence,
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
    // Retrying an LLM stream would replay UI chunks that were already delivered.
    // The AI provider still retries transient model requests within this run.
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
