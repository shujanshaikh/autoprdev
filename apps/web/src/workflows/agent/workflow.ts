import {
  applyAgenticCache,
  CodingHarness,
  createCachedSystemMessage,
  type SandboxSessionOptions,
} from "@autopr/agent";
import { api } from "@autopr/backend/convex/_generated/api";
import { createOpenAI } from "@ai-sdk/openai";
import { DurableAgent } from "@workflow/ai/agent";
import { type ModelMessage, type UIMessageChunk } from "ai";
import { fetchMutation } from "convex/nextjs";
import { getWorkflowMetadata, getWritable } from "workflow";
import { responseMessagesToAssistantParts } from "@/lib/chat-messages";
import { getWorkOSVault, parseStoredCodexCredential } from "#/lib/codex-auth-server";

export interface AgentWorkflowOptions {
  projectId?: string;
  threadId?: string;
  sandboxCacheKey: string;
  sandboxId?: string;
  repoUrl?: string;
  repoBranch?: string;
  assistantMessageId?: string;
  convexAuthToken?: string;
  codex?: CodexAgentModelOptions;
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
  convexAuthToken: string;
  threadId: string;
  assistantMessageId: string;
}

interface AssistantUsageMetadata {
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
  };
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
  convexAuthToken,
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
    { token: convexAuthToken, url: getConvexUrl() },
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
  convexAuthToken,
  threadId,
  runId,
}: Pick<AssistantPersistenceOptions, "convexAuthToken" | "threadId"> & {
  runId: string;
}) {
  "use step";

  await fetchMutation(
    api.threads.markRunFinished,
    { threadId, runId },
    { token: convexAuthToken, url: getConvexUrl() },
  );
}

function getAssistantPersistenceOptions(options: AgentWorkflowOptions): AssistantPersistenceOptions | null {
  if (!options.convexAuthToken || !options.threadId || !options.assistantMessageId) {
    return null;
  }

  return {
    convexAuthToken: options.convexAuthToken,
    threadId: options.threadId,
    assistantMessageId: options.assistantMessageId,
  };
}

function responseInputContentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function codexPromptCacheKey(options: AgentWorkflowOptions) {
  const source = options.threadId ?? options.sandboxCacheKey;
  const stableSegment = source.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);

  return `autopr-${stableSegment}`;
}

function codexOpenAIModel(options: CodexAgentModelOptions) {
  return async () => {
    "use step";

    const vaultObject = await getWorkOSVault().readObject({ id: options.vaultObjectId });
    const credential = parseStoredCodexCredential(vaultObject.value);

    if (credential.expiresAt <= Date.now()) {
      throw new Error("Codex credentials expired. Reconnect Codex and try again.");
    }

    const provider = createOpenAI({
      apiKey: credential.accessToken,
      fetch: async (input, init) => {
        const requestUrl = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
        const url = requestUrl.pathname.includes("/v1/responses") || requestUrl.pathname.includes("/chat/completions")
          ? new URL("https://chatgpt.com/backend-api/codex/responses")
          : requestUrl;

        const headers = new Headers(init?.headers);
        headers.set("authorization", `Bearer ${credential.accessToken}`);
        const accountId = credential.accountId ?? options.accountId;
        if (accountId) {
          headers.set("ChatGPT-Account-Id", accountId);
        }

        const nextInit: RequestInit = { ...init, headers };
        if (typeof nextInit.body === "string" && nextInit.method === "POST") {
          const body = JSON.parse(nextInit.body) as {
            instructions?: string;
            input?: Array<Record<string, unknown>>;
            prompt_cache_key?: string;
            reasoning?: Record<string, unknown>;
            store?: boolean;
          };

          body.store = false;
          body.prompt_cache_key = body.prompt_cache_key || options.promptCacheKey;
          body.reasoning = { ...body.reasoning, effort: options.reasoningEffort };

          if (Array.isArray(body.input)) {
            const instructions = body.input
              .filter((item) => item.role === "system" || item.role === "developer")
              .map((item) => responseInputContentToText(item.content))
              .filter(Boolean)
              .join("\n");

            body.input = body.input.filter((item) => item.type !== "item_reference");

            if (!body.instructions && instructions) {
              body.instructions = instructions;
              body.input = body.input.filter((item) => item.role !== "system" && item.role !== "developer");
            }

          }

          nextInit.body = JSON.stringify(body);
        }

        const response = await fetch(url, nextInit);
        if (!response.ok) {
          const errorBody = await response.clone().text().catch(() => "<failed to read response body>");
          throw new Error(
            `Codex API request failed: ${response.status} ${response.statusText} ${errorBody}`,
          );
        }

        return response;
      },
    });
    const model = provider.responses(options.modelId);

    const accountId = credential.accountId ?? options.accountId;
    if (accountId) {
      const originalDoStream = model.doStream.bind(model);
      model.doStream = (callOptions) =>
        originalDoStream({
          ...callOptions,
          headers: {
            ...callOptions.headers,
            "ChatGPT-Account-Id": accountId,
          },
        });
    }

    return model;
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
  const harness = new CodingHarness({
    ...sandboxOptions,
    appendSystemPrompt: [
      "This chat is streamed through a durable workflow. The Daytona sandbox is created before you answer and all tools operate inside that sandbox.",
      options.repoUrl ? `Repository: ${options.repoUrl}` : undefined,
      options.repoBranch ? `Repository branch: ${options.repoBranch}` : undefined,
      options.projectId ? `Project ID: ${options.projectId}` : undefined,
      options.threadId ? `Thread ID: ${options.threadId}` : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  if (options.codex?.expiresAt && options.codex.expiresAt <= Date.now()) {
    throw new Error("Codex credentials expired. Reconnect Codex and try again.");
  }

  const codexOptions = options.codex
    ? {
        ...options.codex,
        promptCacheKey: options.codex.promptCacheKey ?? codexPromptCacheKey(options),
      }
    : undefined;

  const writable = getWritable<UIMessageChunk>();

  if (options.assistantMessageId) {
    await writeAssistantStartChunk(writable, options.assistantMessageId);
  }

  try {
    await harness.run(async ({ instructions, tools }) => {
      const agent = new DurableAgent({
        model: codexOptions ? codexOpenAIModel(codexOptions) : "minimax/minimax-m2.7",
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
        providerOptions: codexOptions
          ? {
              openai: {
                store: false,
                instructions,
                promptCacheKey: codexOptions.promptCacheKey,
                reasoningEffort: codexOptions.reasoningEffort,
                reasoningSummary: "auto",
                include: ["reasoning.encrypted_content"],
              },
            }
          : undefined,
        onFinish: async ({ messages, steps }) => {
          if (!persistence) {
            return;
          }

          const usageMetadata: AssistantUsageMetadata = {
            usage: steps.reduce(
              (total, step) => ({
                inputTokens: total.inputTokens + (step.usage.inputTokens ?? 0),
                outputTokens: total.outputTokens + (step.usage.outputTokens ?? 0),
                totalTokens: total.totalTokens + (step.usage.totalTokens ?? 0),
                cachedInputTokens: total.cachedInputTokens + (step.usage.cachedInputTokens ?? 0),
              }),
              {
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                cachedInputTokens: 0,
              },
            ),
          };

          try {
            await writeAssistantMetadataChunk(writable, usageMetadata);
            await patchAssistantMessage({
              ...persistence,
              parts: responseMessagesToAssistantParts(messages, inputMessages.length),
              metadata: usageMetadata,
            });
          } catch (error) {
            if (!isPersistenceUnauthenticatedError(error)) {
              throw error;
            }
          }
        },
      });
    });
  } finally {
    if (persistence) {
      try {
        await markWorkflowRunFinished({
          convexAuthToken: persistence.convexAuthToken,
          threadId: persistence.threadId,
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
