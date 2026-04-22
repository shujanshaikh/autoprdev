import {
  buildSandboxAgentSystemPrompt,
  createDaytonaTools,
  prepareDaytonaSandbox,
  type SandboxSessionOptions,
} from "@autopr/agent";
import { api } from "@autopr/backend/convex/_generated/api";
import { DurableAgent } from "@workflow/ai/agent";
import type { ModelMessage, UIMessage, UIMessageChunk } from "ai";
import { ConvexHttpClient } from "convex/browser";
import { getWorkflowMetadata, getWritable } from "workflow";

export interface AgentWorkflowOptions {
  projectId?: string;
  threadId?: string;
  sandboxCacheKey: string;
  sandboxId?: string;
  repoUrl?: string;
  repoBranch?: string;
  assistantMessageId?: string;
  convexUrl?: string;
  convexAuthToken?: string;
}

interface AssistantPersistenceOptions {
  convexUrl: string;
  convexAuthToken: string;
  threadId: string;
  assistantMessageId: string;
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
  convexUrl,
  convexAuthToken,
  threadId,
  assistantMessageId,
  parts,
  metadata,
}: AssistantPersistenceOptions & {
  parts: UIMessage["parts"];
  metadata?: unknown;
}) {
  "use step";

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(convexAuthToken);

  await client.mutation(api.messages.patchAssistant, {
    threadId,
    assistantMessageId,
    parts,
    metadata,
  });
}

async function markWorkflowRunFinished({
  convexUrl,
  convexAuthToken,
  threadId,
  runId,
}: Pick<AssistantPersistenceOptions, "convexUrl" | "convexAuthToken" | "threadId"> & {
  runId: string;
}) {
  "use step";

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(convexAuthToken);

  await client.mutation(api.threads.markRunFinished, {
    threadId,
    runId,
  });
}

function getAssistantPersistenceOptions(options: AgentWorkflowOptions): AssistantPersistenceOptions | null {
  if (!options.convexUrl || !options.convexAuthToken || !options.threadId || !options.assistantMessageId) {
    return null;
  }

  return {
    convexUrl: options.convexUrl,
    convexAuthToken: options.convexAuthToken,
    threadId: options.threadId,
    assistantMessageId: options.assistantMessageId,
  };
}

function textToAssistantParts(text: string): UIMessage["parts"] {
  if (!text) {
    return [];
  }

  return [
    {
      type: "text",
      text,
      state: "done",
    },
  ];
}

export async function agentWorkflow(messages: ModelMessage[], options: AgentWorkflowOptions) {
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
    instructions,
    tools,
    toolChoice: "auto",
  });

  const writable = getWritable<UIMessageChunk>();

  if (options.assistantMessageId) {
    await writeAssistantStartChunk(writable, options.assistantMessageId);
  }

  try {
    await agent.stream({
      messages,
      writable,
      sendStart: !options.assistantMessageId,
      maxSteps: 12,
      onFinish: async ({ text, finishReason, totalUsage }) => {
        if (!persistence) {
          return;
        }

        await patchAssistantMessage({
          ...persistence,
          parts: textToAssistantParts(text),
          metadata: {
            finishReason,
            totalUsage,
          },
        });
      },
    });
  } finally {
    if (persistence) {
      await markWorkflowRunFinished({
        convexUrl: persistence.convexUrl,
        convexAuthToken: persistence.convexAuthToken,
        threadId: persistence.threadId,
        runId: workflowRunId,
      });
    }
  }
}
