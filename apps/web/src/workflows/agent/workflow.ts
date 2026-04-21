import {
  buildSandboxAgentSystemPrompt,
  createDaytonaTools,
  prepareDaytonaSandbox,
  type SandboxSessionOptions,
} from "@autopr/agent";
import { DurableAgent } from "@workflow/ai/agent";
import type { ModelMessage, UIMessageChunk } from "ai";
import { getWritable } from "workflow";

export interface AgentWorkflowOptions {
  projectId?: string;
  threadId?: string;
  sandboxCacheKey: string;
  sandboxId?: string;
  repoUrl?: string;
  repoBranch?: string;
  assistantMessageId?: string;
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

export async function agentWorkflow(messages: ModelMessage[], options: AgentWorkflowOptions) {
  "use workflow";

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

  await agent.stream({
    messages,
    writable,
    sendStart: !options.assistantMessageId,
    maxSteps: 12,
  });
}
