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
  repoUrl?: string;
  repoBranch?: string;
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
};

interface AssistantUsageMetadata {
  usage: AssistantTokenUsageMetadata;
  contextUsage: AssistantTokenUsageMetadata;
}

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
  };
}

function tokenUsageFromStep(step: { usage: Partial<AssistantTokenUsageMetadata> }): AssistantTokenUsageMetadata {
  return {
    inputTokens: step.usage.inputTokens ?? 0,
    outputTokens: step.usage.outputTokens ?? 0,
    totalTokens: step.usage.totalTokens ?? 0,
    cachedInputTokens: step.usage.cachedInputTokens ?? 0,
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
    repoUrl: options.repoUrl,
    repoBranch: options.repoBranch,
  };
  const demoRecordingBasePath = options.demoEnabled && options.projectId && options.threadId
    ? `/api/project/${encodeURIComponent(options.projectId)}` +
      `/thread/${encodeURIComponent(options.threadId)}`
    : undefined;
  const harness = new CodingHarness({
    ...sandboxOptions,
    computer: demoRecordingBasePath
      ? { recordingBasePath: demoRecordingBasePath }
      : false,
    appendSystemPrompt: [
      "This chat is streamed through a durable workflow. The Daytona sandbox is created before you answer and all tools operate inside that sandbox.",
      options.repoUrl ? `Repository: ${options.repoUrl}` : undefined,
      options.repoBranch ? `Repository branch: ${options.repoBranch}` : undefined,
      options.projectId ? `Project ID: ${options.projectId}` : undefined,
      options.threadId ? `Thread ID: ${options.threadId}` : undefined,
      demoRecordingBasePath
        ? "Demo mode is enabled for this thread. After completing the requested work, use the computer tool inside Daytona to open the browser preview and record a concise final demo video. Start recording only after the app is ready and the demo path is clear; stop recording promptly and include the recording metadata in your response. Skip this only if no meaningful browser preview is possible, and explain the concrete blocker."
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
