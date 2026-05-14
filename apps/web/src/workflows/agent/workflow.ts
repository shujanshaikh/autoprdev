import {
  applyAgenticCache,
  buildSandboxAgentSystemPrompt,
  createCachedSystemMessage,
  createDaytonaTools,
  prepareDaytonaSandbox,
  type SandboxSessionOptions,
} from "@autopr/agent";
import { api } from "@autopr/backend/convex/_generated/api";
import { DurableAgent, type StreamTextTransform } from "@workflow/ai/agent";
import { smoothStream, type ModelMessage, type UIMessageChunk } from "ai";
import { fetchMutation } from "convex/nextjs";
import { getWorkflowMetadata, getWritable } from "workflow";
import { responseMessagesToAssistantParts } from "@/lib/chat-messages";

export interface AgentWorkflowOptions {
  projectId?: string;
  threadId?: string;
  sandboxCacheKey: string;
  sandboxId?: string;
  repoUrl?: string;
  repoBranch?: string;
  assistantMessageId?: string;
  convexAuthToken?: string;
}

interface AssistantPersistenceOptions {
  convexAuthToken: string;
  threadId: string;
  assistantMessageId: string;
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
}: AssistantPersistenceOptions & {
  parts: unknown[];
}) {
  "use step";

  await fetchMutation(
    api.messages.patchAssistant,
    { threadId, assistantMessageId, parts },
    { token: convexAuthToken, url: getConvexUrl() },
  );
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
  const sandbox = await prepareDaytonaSandbox(sandboxOptions);
  const tools = createDaytonaTools(sandboxOptions);
  const instructions = buildSandboxAgentSystemPrompt({
    cwd: sandbox.workDir,
    sandboxId: sandbox.sandboxId,
    sandboxName: sandbox.sandboxName,
    snapshot: sandbox.snapshot,
    selectedTools: Object.keys(tools),
    appendSystemPrompt:
      [
        "This chat is streamed through a durable workflow. The Daytona sandbox is created before you answer and all tools operate inside that sandbox.",
        options.repoUrl ? `Repository: ${options.repoUrl}` : undefined,
        options.repoBranch ? `Repository branch: ${options.repoBranch}` : undefined,
        `Sandbox ID: ${sandbox.sandboxId}`,
        `Working directory: ${sandbox.workDir}`,
        options.projectId ? `Project ID: ${options.projectId}` : undefined,
        options.threadId ? `Thread ID: ${options.threadId}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
  });

  const agent = new DurableAgent({
    model: "minimax/minimax-m2.7",
    instructions: createCachedSystemMessage(instructions),
    tools,
    toolChoice: "required",
  });
  const writable = getWritable<UIMessageChunk>();

  if (options.assistantMessageId) {
    await writeAssistantStartChunk(writable, options.assistantMessageId);
  }

  try {
    await agent.stream({
      messages: applyAgenticCache(inputMessages),
      writable,
      sendStart: !options.assistantMessageId,
      maxSteps: 100,
      onFinish: async ({ messages }) => {
        if (!persistence) {
          return;
        }

        try {
          await patchAssistantMessage({
            ...persistence,
            parts: responseMessagesToAssistantParts(messages, inputMessages.length),
          });
        } catch (error) {
          if (!isPersistenceUnauthenticatedError(error)) {
            throw error;
          }
        }
      },
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
