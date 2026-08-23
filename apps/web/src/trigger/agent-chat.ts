import {
  applyAgenticCache,
  CodingHarness,
  COMPUTER_USE_WITHOUT_RECORDING_INSTRUCTIONS,
  createAgentStepController,
  createSandboxTools,
  DEMO_RECORDING_INSTRUCTIONS,
  type SandboxSessionOptions,
  withSandboxAgentProjectContext,
} from "@autopr/agent";
import { api } from "@autopr/backend/convex/_generated/api";
import { chat } from "@trigger.dev/sdk/ai";
import { fetchAction } from "convex/nextjs";
import { stepCountIs, streamText, type UIMessage, wrapLanguageModel } from "ai";
import { z } from "zod";

import {
  createAgentContextCompactor,
  createContextOverflowRecoveryMiddleware,
} from "#/lib/agent-context-compaction";
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
import {
  agentProviderOptions,
  agentSystemPrompt,
  createAgentResponsesModel,
  revokeAgentModelGrant,
} from "#/lib/agent-auth-runtime-server";
import { getAgentContextLimit, isAgentReasoningEffortSupported } from "#/lib/agent-models";
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
  sandboxProvider: z.enum(["daytona", "e2b"]).default("daytona"),
  sandboxWorkDir: z.string().min(1).optional(),
  repoUrl: z.string().min(1).optional(),
  repoBranch: z.string().min(1).optional(),
  repoName: z.string().min(1).optional(),
  persistenceToken: z.string().min(1),
  demoEnabled: z.boolean().optional(),
  model: z.discriminatedUnion("provider", [
    z.object({
      provider: z.literal("openai-codex"),
      modelId: z.string().min(1),
      reasoningEffort: z.string().min(1),
      promptCacheKey: z.string().min(1).optional(),
      credentialsGrantId: z.string().min(1),
      credentialsGrantContext: z.object({
        userId: z.string().min(1),
        taskId: z.literal(AGENT_CHAT_TASK_ID),
        contextId: z.string().min(1),
      }),
    }),
    z.object({
      provider: z.literal("xai"),
      modelId: z.string().min(1),
      reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
      promptCacheKey: z.string().min(1).optional(),
      credentialsGrantId: z.string().min(1),
      credentialsGrantContext: z.object({
        userId: z.string().min(1),
        taskId: z.literal(AGENT_CHAT_TASK_ID),
        contextId: z.string().min(1),
      }),
    }).superRefine((model, context) => {
      if (model.reasoningEffort && !isAgentReasoningEffortSupported(model, model.reasoningEffort)) {
        context.addIssue({
          code: "custom",
          path: ["reasoningEffort"],
          message: `${model.reasoningEffort} reasoning is not supported by ${model.modelId}.`,
        });
      }
    }),
  ]),
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
    provider: clientData.sandboxProvider,
    cacheKey: clientData.sandboxCacheKey,
    sandboxId: clientData.sandboxId,
    workDir: clientData.sandboxWorkDir,
    repoUrl: clientData.repoUrl,
    repoBranch: clientData.repoBranch,
    repoName: clientData.repoName,
  };
}

function modelPromptCacheKey(clientData: AgentChatClientData) {
  const stableSegment = clientData.threadId
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 120);
  return `autopr-${stableSegment}`;
}

function demoInstructions(clientData: AgentChatClientData) {
  return clientData.demoEnabled
    ? DEMO_RECORDING_INSTRUCTIONS
    : COMPUTER_USE_WITHOUT_RECORDING_INSTRUCTIONS;
}

function modelInstructions(clientData: AgentChatClientData) {
  const provider = clientData.sandboxProvider === "e2b" ? "E2B" : "Daytona";
  return [
    `This chat is streamed through a durable Trigger.dev Session. The ${provider} sandbox is prepared before you answer and all tools operate inside that sandbox.`,
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
    return createSandboxTools(sandboxOptions(trusted), {
      computer: { recordingEnabled: Boolean(trusted.demoEnabled) },
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

    try {
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
    } finally {
      await revokeAgentModelGrant(trusted.model).catch((revokeError) => {
        console.error("Failed to revoke the model credential grant", revokeError);
      });
    }
  },
  run: async ({ chatId, clientData, messages, signal, tools }) => {
    const trusted = requireClientData(clientData, chatId);
    const harness = new CodingHarness({
      ...sandboxOptions(trusted),
      computer: { recordingEnabled: Boolean(trusted.demoEnabled) },
      modelId: trusted.model.modelId,
      modelProviderName: trusted.model.provider === "xai" ? "SuperGrok subscription" : "ChatGPT / Codex subscription",
      appendSystemPrompt: modelInstructions(trusted),
    });
    const selectedModel = {
      ...trusted.model,
      promptCacheKey:
        trusted.model.promptCacheKey ?? modelPromptCacheKey(trusted),
    };
    const startedAt = Date.now();
    const { instructions, repositoryContext } = await harness.prepare();
    const model = wrapLanguageModel({
      model: await createAgentResponsesModel(selectedModel),
      middleware: createContextOverflowRecoveryMiddleware(),
    });

    return streamText({
      ...chat.toStreamTextOptions({ tools }),
      model,
      system: agentSystemPrompt(selectedModel, instructions),
      messages: applyAgenticCache(
        withSandboxAgentProjectContext(messages, repositoryContext),
      ),
      tools,
      toolChoice: "auto",
      stopWhen: stepCountIs(MAX_AGENT_STEPS),
      maxRetries: 2,
      abortSignal: signal,
      prepareStep: createAgentStepController({
        prepareStep: createAgentContextCompactor({
          contextWindow: getAgentContextLimit(selectedModel),
          systemPrompt: instructions,
          abortSignal: signal,
        }),
      }),
      onFinish: ({ steps }) => {
        turnState.usageMetadata = createAssistantUsageMetadata(
          steps,
          selectedModel.modelId,
          startedAt,
        );
      },
      providerOptions: agentProviderOptions(selectedModel, instructions),
    });
  },
});
