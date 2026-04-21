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
  sandboxCacheKey: string;
}

export async function agentWorkflow(messages: ModelMessage[], options: AgentWorkflowOptions) {
  "use workflow";

  const sandboxOptions: SandboxSessionOptions = {
    cacheKey: options.sandboxCacheKey,
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
      "This chat is streamed through a durable workflow. The Daytona sandbox is created before you answer and all tools operate inside that sandbox.",
  });

  const agent = new DurableAgent({
    model: "minimax/minimax-m2.7",
    instructions,
    tools,
    toolChoice: "auto",
  });

  await agent.stream({
    messages,
    writable: getWritable<UIMessageChunk>(),
    maxSteps: 12,
  });
}
