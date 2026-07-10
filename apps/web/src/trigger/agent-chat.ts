import {
  applyAgenticCache,
  CodingHarness,
  createCachedSystemMessage,
  createDaytonaTools,
  type SandboxSessionOptions,
} from "@autopr/agent";
import { api } from "@autopr/backend/convex/_generated/api";
import { chat } from "@trigger.dev/sdk/ai";
import { fetchAction } from "convex/nextjs";
import { stepCountIs, streamText, type UIMessage } from "ai";
import { z } from "zod";

import { compactPromptMessagesForModel } from "#/lib/agent-message-compaction";
import {
  agentRunIssueFromError,
  displayAgentError,
} from "#/lib/agent-run-issue";
import {
  createAssistantUsageMetadata,
  type AssistantUsageMetadata,
} from "#/lib/agent-usage";
import {
  sanitizeAssistantPartsForPersistence,
  sanitizeStoppedAssistantParts,
  toUIMessage,
  type StoredMessageRow,
} from "#/lib/chat-messages";
import { createCodexResponsesModel } from "#/lib/codex-auth-server";
import {
  AGENT_CHAT_TASK_ID,
  type AgentChatClientData,
} from "#/lib/trigger-agent-contract";

const MAX_AGENT_STEPS = 100;

const agentChatClientDataSchema = z.object({
  projectId: z.string().min(1),
  threadId: z.string().min(1),
  sandboxCacheKey: z.string().min(1),
  sandboxId: z.string().min(1).optional(),
  sandboxWorkDir: z.string().min(1).optional(),
  repoUrl: z.string().min(1).optional(),
  repoBranch: z.string().min(1).optional(),
  repoName: z.string().min(1).optional(),
  persistenceToken: z.string().min(1),
  demoEnabled: z.boolean().optional(),
  codex: z.object({
    provider: z.literal("openai-codex"),
    modelId: z.string().min(1),
    reasoningEffort: z.string().min(1),
    promptCacheKey: z.string().min(1).optional(),
    chatgptCookieHeader: z.string().min(1),
  }),
}) satisfies z.ZodType<AgentChatClientData>;

const turnState = chat.local<{
  usageMetadata?: AssistantUsageMetadata;
}>({ id: "autopr-agent-turn" });

function getConvexUrl() {
  const url = process.env.VITE_CONVEX_URL;
  if (!url) {
    throw new Error("Missing VITE_CONVEX_URL in the Trigger.dev environment");
  }
  return url;
}

function requireClientData(
  clientData: AgentChatClientData | undefined,
  chatId: string,
): AgentChatClientData {
  if (!clientData || clientData.threadId !== chatId) {
    throw new Error("The authenticated agent context does not match this chat session.");
  }

  return clientData;
}

function sandboxOptions(clientData: AgentChatClientData): SandboxSessionOptions {
  return {
    cacheKey: clientData.sandboxCacheKey,
    sandboxId: clientData.sandboxId,
    workDir: clientData.sandboxWorkDir,
    repoUrl: clientData.repoUrl,
    repoBranch: clientData.repoBranch,
    repoName: clientData.repoName,
  };
}

function codexPromptCacheKey(clientData: AgentChatClientData) {
  const stableSegment = clientData.threadId
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 120);
  return `autopr-${stableSegment}`;
}

function demoInstructions(clientData: AgentChatClientData) {
  return clientData.demoEnabled
    ? "Demo mode is enabled for this thread. After completing the requested work, use the computer tool inside Daytona to open the browser preview in Google Chrome and record a concise final demo video. Start recording only after the app is ready and the demo path is clear; give start_recording and stop_recording the same concise descriptive title for the final embedded video. Stop recording promptly. The chat UI embeds the recording automatically from tool output; do not print raw recording URLs, IDs, file paths, or metadata unless the user explicitly asks for them. Skip this only if no meaningful browser preview is possible, and explain the concrete blocker."
    : undefined;
}

function modelInstructions(clientData: AgentChatClientData) {
  return [
    "This chat is streamed through a durable Trigger.dev Session. The Daytona sandbox is prepared before you answer and all tools operate inside that sandbox.",
    clientData.repoUrl ? `Repository: ${clientData.repoUrl}` : undefined,
    clientData.repoBranch ? `Repository branch: ${clientData.repoBranch}` : undefined,
    clientData.sandboxWorkDir
      ? `Sandbox working directory: ${clientData.sandboxWorkDir}`
      : undefined,
    `Project ID: ${clientData.projectId}`,
    `Thread ID: ${clientData.threadId}`,
    demoInstructions(clientData),
  ]
    .filter(Boolean)
    .join("\n");
}

export const agentChatTask = chat.agent({
  id: AGENT_CHAT_TASK_ID,
  machine: "small-1x",
  maxTurns: 1_000,
  turnTimeout: "1h",
  idleTimeoutInSeconds: 30,
  exitAfterPreloadIdle: true,
  clientDataSchema: agentChatClientDataSchema,
  onBoot: () => {
    turnState.init({});
  },
  tools: ({ chatId, clientData }) => {
    const trusted = requireClientData(clientData, chatId);
    return createDaytonaTools(sandboxOptions(trusted), {
      computer: trusted.demoEnabled ? {} : false,
    });
  },
  hydrateMessages: async ({ chatId, clientData, incomingMessages }) => {
    const trusted = requireClientData(clientData, chatId);
    const messages = await fetchAction(
      api.messages.hydrateThreadFromAgentSession,
      {
        threadId: chatId,
        persistenceToken: trusted.persistenceToken,
        incomingMessages,
      },
      { url: getConvexUrl() },
    );

    return messages.flatMap((message: StoredMessageRow) => {
      const uiMessage = toUIMessage(message);
      return uiMessage.role !== "assistant" || uiMessage.parts.length > 0
        ? [uiMessage]
        : [];
    });
  },
  onTurnStart: async ({ chatId, clientData, runId }) => {
    const trusted = requireClientData(clientData, chatId);
    turnState.usageMetadata = undefined;
    await fetchAction(
      api.threads.markAgentSessionTurnStartedFromAgent,
      {
        threadId: chatId,
        persistenceToken: trusted.persistenceToken,
        runId,
      },
      { url: getConvexUrl() },
    );
  },
  prepareMessages: ({ messages }) => compactPromptMessagesForModel(messages),
  uiMessageStreamOptions: {
    onError: displayAgentError,
  },
  onBeforeTurnComplete: ({ writer }) => {
    if (turnState.usageMetadata) {
      writer.write({
        type: "message-metadata",
        messageMetadata: turnState.usageMetadata,
      });
    }
  },
  onTurnComplete: async ({
    chatId,
    clientData,
    ctx,
    error,
    lastEventId,
    responseMessage,
    runId,
    stopped,
  }) => {
    const trusted = requireClientData(clientData, chatId);
    const persistedResponse: UIMessage | undefined = responseMessage
      ? {
          ...responseMessage,
          parts:
            stopped || error
              ? sanitizeStoppedAssistantParts(responseMessage.parts)
              : sanitizeAssistantPartsForPersistence(responseMessage.parts),
          metadata: turnState.usageMetadata ?? responseMessage.metadata,
        }
      : undefined;

    await fetchAction(
      api.messages.completeAgentSessionTurnFromAgent,
      {
        threadId: chatId,
        persistenceToken: trusted.persistenceToken,
        runId,
        lastEventId,
        responseMessage: persistedResponse,
        issue: error
          ? agentRunIssueFromError(error, runId, ctx.attempt.number)
          : undefined,
      },
      { url: getConvexUrl() },
    );
  },
  run: async ({ chatId, clientData, messages, signal, tools }) => {
    const trusted = requireClientData(clientData, chatId);
    const harness = new CodingHarness({
      ...sandboxOptions(trusted),
      computer: trusted.demoEnabled ? {} : false,
      modelId: trusted.codex.modelId,
      appendSystemPrompt: modelInstructions(trusted),
    });
    const codex = {
      ...trusted.codex,
      promptCacheKey:
        trusted.codex.promptCacheKey ?? codexPromptCacheKey(trusted),
    };
    const startedAt = Date.now();
    const { instructions } = await harness.prepare();
    const model = await createCodexResponsesModel(codex);

    return streamText({
      ...chat.toStreamTextOptions({ tools }),
      model,
      system: createCachedSystemMessage(instructions),
      messages: applyAgenticCache(messages),
      tools,
      toolChoice: "auto",
      stopWhen: stepCountIs(MAX_AGENT_STEPS),
      maxRetries: 1,
      abortSignal: signal,
      onFinish: ({ steps }) => {
        turnState.usageMetadata = createAssistantUsageMetadata(
          steps,
          codex.modelId,
          startedAt,
        );
      },
      providerOptions: {
        openai: {
          store: false,
          instructions,
          parallelToolCalls: true,
          promptCacheKey: codex.promptCacheKey,
          reasoningEffort: codex.reasoningEffort,
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
      },
    });
  },
});
