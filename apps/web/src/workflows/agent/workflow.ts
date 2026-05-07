import {
  applyAgenticCache,
  buildSandboxAgentSystemPrompt,
  createCachedSystemMessage,
  createDaytonaTools,
  prepareDaytonaSandbox,
  type SandboxSessionOptions,
} from "@autopr/agent";
import { DurableAgent } from "@workflow/ai/agent";
import type { ModelMessage, UIMessageChunk } from "ai";
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
  appUrl?: string;
  clerkAuthToken?: string;
}

interface AssistantPersistenceOptions {
  appUrl: string;
  clerkAuthToken: string;
  projectId: string;
  threadId: string;
  assistantMessageId: string;
}

function isPersistenceUnauthenticatedError(error: unknown) {
  return error instanceof Error && error.message.includes("Persistence request failed with 401");
}

async function postPersistenceRequest(
  { appUrl, clerkAuthToken, projectId, threadId }: Omit<AssistantPersistenceOptions, "assistantMessageId">,
  body: unknown,
) {
  const response = await fetch(new URL(`/api/project/${projectId}/thread/${threadId}/agent/persistence`, appUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${clerkAuthToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Persistence request failed with ${response.status}: ${await response.text()}`);
  }
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
  appUrl,
  clerkAuthToken,
  projectId,
  threadId,
  assistantMessageId,
  parts,
}: AssistantPersistenceOptions & {
  parts: unknown[];
}) {
  "use step";

  await postPersistenceRequest(
    { appUrl, clerkAuthToken, projectId, threadId },
    { action: "patchAssistant", assistantMessageId, parts },
  );
}

async function markWorkflowRunFinished({
  appUrl,
  clerkAuthToken,
  projectId,
  threadId,
  runId,
}: Pick<AssistantPersistenceOptions, "appUrl" | "clerkAuthToken" | "projectId" | "threadId"> & {
  runId: string;
}) {
  "use step";

  await postPersistenceRequest({ appUrl, clerkAuthToken, projectId, threadId }, { action: "markRunFinished", runId });
}

function getAssistantPersistenceOptions(options: AgentWorkflowOptions): AssistantPersistenceOptions | null {
  if (!options.appUrl || !options.clerkAuthToken || !options.projectId || !options.threadId || !options.assistantMessageId) {
    return null;
  }

  return {
    appUrl: options.appUrl,
    clerkAuthToken: options.clerkAuthToken,
    projectId: options.projectId,
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
      maxSteps: 12,
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
          appUrl: persistence.appUrl,
          clerkAuthToken: persistence.clerkAuthToken,
          projectId: persistence.projectId,
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
