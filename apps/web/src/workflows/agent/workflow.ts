import {
  applyAgenticCache,
  CodingHarness,
  createCachedSystemMessage,
  type SandboxSessionOptions,
} from "@autopr/agent";
import { api } from "@autopr/backend/convex/_generated/api";
import { DurableAgent } from "@workflow/ai/agent";
import { type ModelMessage, type UIMessageChunk } from "ai";
import { fetchMutation } from "convex/nextjs";
import { getWorkflowMetadata, getWritable } from "workflow";
import { responseMessagesToAssistantParts } from "@/lib/chat-messages";
import { createCodexResponsesModel } from "#/lib/codex-auth-server";
import { getAuthkit } from "@workos/authkit-tanstack-react-start";
import type { Impersonator, User } from "@workos-inc/node";

export interface AgentWorkflowOptions {
  projectId?: string;
  threadId?: string;
  sandboxCacheKey: string;
  sandboxId?: string;
  sandboxWorkDir?: string;
  repoUrl?: string;
  repoBranch?: string;
  repoName?: string;
  assistantMessageId?: string;
  demoEnabled?: boolean;
  convexAuth?: WorkOSWorkflowAuth;
  codex: CodexAgentModelOptions;
}

interface CodexAgentModelOptions {
  provider: "openai-codex";
  modelId: string;
  reasoningEffort: string;
  promptCacheKey?: string;
  vaultObjectId: string;
  vaultVersionId?: string;
  accountId?: string;
  expiresAt: number;
}

interface AssistantPersistenceOptions {
  convexAuth: WorkOSWorkflowAuth;
  threadId: string;
  assistantMessageId: string;
}

interface WorkOSWorkflowAuth {
  accessToken: string;
  refreshToken: string;
  user: User;
  impersonator?: Impersonator;
}

type AssistantTokenUsageMetadata = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
};

interface AssistantUsageMetadata {
  usage: AssistantTokenUsageMetadata;
  contextUsage: AssistantTokenUsageMetadata;
}

type WorkflowIssue = {
  workflowRunId: string;
  stepName?: string;
  attempt?: number;
  retryCount?: number;
  message: string;
  errorStack?: string;
  occurredAt: number;
};

function getConvexUrl() {
  const url = process.env.VITE_CONVEX_URL;
  if (!url) {
    throw new Error("Missing VITE_CONVEX_URL in your web environment");
  }
  return url;
}

function isPersistenceUnauthenticatedError(error: unknown) {
  return error instanceof Error && error.message.includes("Unauthorized");
}

function emptyTokenUsage(): AssistantTokenUsageMetadata {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
  };
}

function tokenUsageFromStep(step: {
  usage: Partial<AssistantTokenUsageMetadata> & {
    inputTokenDetails?: {
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    };
  };
}): AssistantTokenUsageMetadata {
  const cachedInputTokens =
    step.usage.inputTokenDetails?.cacheReadTokens ?? step.usage.cachedInputTokens ?? 0;

  return {
    inputTokens: step.usage.inputTokens ?? 0,
    outputTokens: step.usage.outputTokens ?? 0,
    totalTokens: step.usage.totalTokens ?? 0,
    cachedInputTokens,
    cacheWriteTokens: step.usage.inputTokenDetails?.cacheWriteTokens ?? step.usage.cacheWriteTokens ?? 0,
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
  if (!readRecordProperty(value, "error")) {
    return undefined;
  }

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

function workflowIssueFromError(error: unknown, workflowRunId: string): WorkflowIssue {
  return {
    workflowRunId,
    stepName: readStringProperty(error, "stepName"),
    attempt: readNumberProperty(error, "attempt"),
    retryCount: readNumberProperty(error, "retryCount"),
    message: displayMessageFromError(error),
    errorStack: error instanceof Error ? error.stack : undefined,
    occurredAt: Date.now(),
  };
}

async function refreshWorkOSConvexAuth(convexAuth: WorkOSWorkflowAuth) {
  "use step";

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
  } satisfies WorkOSWorkflowAuth;
}

async function writeAssistantStartChunk(writable: WritableStream<UIMessageChunk>, messageId: string) {
  "use step";

  const writer = writable.getWriter();

  try {
    await writer.write({
      type: "start",
      messageId,
    });
  } finally {
    writer.releaseLock();
  }
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
  "use step";

  await fetchMutation(
    api.messages.patchAssistant,
    { threadId, assistantMessageId, parts, metadata },
    { token: convexAuth.accessToken, url: getConvexUrl() },
  );
}

async function writeAssistantMetadataChunk(
  writable: WritableStream<UIMessageChunk>,
  metadata: AssistantUsageMetadata,
) {
  "use step";

  const writer = writable.getWriter();

  try {
    await writer.write({
      type: "message-metadata",
      messageMetadata: metadata,
    });
  } finally {
    writer.releaseLock();
  }
}

async function markWorkflowRunFinished({
  convexAuth,
  threadId,
  runId,
}: Pick<AssistantPersistenceOptions, "convexAuth" | "threadId"> & {
  runId: string;
}) {
  "use step";

  await fetchMutation(
    api.threads.markRunFinished,
    { threadId, runId },
    { token: convexAuth.accessToken, url: getConvexUrl() },
  );
}

async function recordWorkflowIssue({
  convexAuth,
  threadId,
  issue,
}: Pick<AssistantPersistenceOptions, "convexAuth" | "threadId"> & {
  issue: WorkflowIssue;
}) {
  "use step";

  await fetchMutation(
    api.threads.recordWorkflowIssue,
    { threadId, issue },
    { token: convexAuth.accessToken, url: getConvexUrl() },
  );
}

function getAssistantPersistenceOptions(options: AgentWorkflowOptions): AssistantPersistenceOptions | null {
  if (!options.convexAuth || !options.threadId || !options.assistantMessageId) {
    return null;
  }

  return {
    convexAuth: options.convexAuth,
    threadId: options.threadId,
    assistantMessageId: options.assistantMessageId,
  };
}

function codexPromptCacheKey(options: AgentWorkflowOptions) {
  const source = options.threadId ?? options.sandboxCacheKey;
  const stableSegment = source.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);

  return `autopr-${stableSegment}`;
}

function codexOpenAIModel(options: CodexAgentModelOptions) {
  return async () => {
    "use step";

    return await createCodexResponsesModel(options);
  };
}

export async function agentWorkflow(inputMessages: ModelMessage[], options: AgentWorkflowOptions) {
  "use workflow";

  const persistence = getAssistantPersistenceOptions(options);
  const { workflowRunId } = getWorkflowMetadata();
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
    appendSystemPrompt: [
      "This chat is streamed through a durable workflow. The Daytona sandbox is created before you answer and all tools operate inside that sandbox.",
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

  if (options.codex?.expiresAt && options.codex.expiresAt <= Date.now()) {
    throw new Error("Codex credentials expired. Reconnect Codex and try again.");
  }

  const codexOptions = {
    ...options.codex,
    promptCacheKey: options.codex.promptCacheKey ?? codexPromptCacheKey(options),
  };

  const writable = getWritable<UIMessageChunk>();
  let persistenceFinished = false;

  if (options.assistantMessageId) {
    await writeAssistantStartChunk(writable, options.assistantMessageId);
  }

  try {
    await harness.run(async ({ instructions, tools }) => {
      const agent = new DurableAgent({
        model: codexOpenAIModel(codexOptions),
        instructions: createCachedSystemMessage(instructions),
        tools,
        toolChoice: "auto",
      });

      await agent.stream({
        messages: applyAgenticCache(inputMessages),
        writable,
        sendStart: !options.assistantMessageId,
        maxSteps: 100,
        maxRetries: 1,
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
        onFinish: async ({ messages, steps }) => {
          if (!persistence) {
            return;
          }

          const stepUsages = steps.map(tokenUsageFromStep);
          const usageMetadata: AssistantUsageMetadata = {
            usage: stepUsages.reduce(addTokenUsage, emptyTokenUsage()),
            contextUsage: stepUsages.at(-1) ?? emptyTokenUsage(),
          };

          try {
            await writeAssistantMetadataChunk(writable, usageMetadata);
            const refreshedPersistence = {
              ...persistence,
              convexAuth: await refreshWorkOSConvexAuth(persistence.convexAuth),
            };
            await patchAssistantMessage({
              ...refreshedPersistence,
              parts: responseMessagesToAssistantParts(messages, inputMessages.length),
              metadata: usageMetadata,
            });
            await markWorkflowRunFinished({
              convexAuth: refreshedPersistence.convexAuth,
              threadId: refreshedPersistence.threadId,
              runId: workflowRunId,
            });
            persistenceFinished = true;
          } catch (error) {
            if (!isPersistenceUnauthenticatedError(error)) {
              throw error;
            }
          }
        },
      });
    });
  } catch (error) {
    if (persistence) {
      try {
        const refreshedPersistence = {
          ...persistence,
          convexAuth: await refreshWorkOSConvexAuth(persistence.convexAuth),
        };
        await recordWorkflowIssue({
          convexAuth: refreshedPersistence.convexAuth,
          threadId: refreshedPersistence.threadId,
          issue: workflowIssueFromError(error, workflowRunId),
        });
        persistenceFinished = true;
      } catch (recordError) {
        if (!isPersistenceUnauthenticatedError(recordError)) {
          console.error("Failed to record workflow issue", recordError);
        }
      }
    }

    throw error;
  } finally {
    if (persistence && !persistenceFinished) {
      try {
        const refreshedPersistence = {
          ...persistence,
          convexAuth: await refreshWorkOSConvexAuth(persistence.convexAuth),
        };
        await markWorkflowRunFinished({
          convexAuth: refreshedPersistence.convexAuth,
          threadId: refreshedPersistence.threadId,
          runId: workflowRunId,
        });
      } catch (error) {
        if (!isPersistenceUnauthenticatedError(error)) {
          throw error;
        }
      }
    }
  }
}
