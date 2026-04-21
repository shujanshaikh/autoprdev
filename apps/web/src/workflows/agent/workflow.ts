import { DurableAgent } from "@workflow/ai/agent";
import { openai } from "@workflow/ai/openai";
import type { ModelMessage, UIMessageChunk } from "ai";
import { getWritable } from "workflow";

const AGENT_INSTRUCTIONS = [
  "You are the autopr durable agent test assistant.",
  "Keep answers concise, practical, and useful for validating chat streaming.",
  "When users ask about implementation details, explain the workflow stream and run id clearly.",
].join("\n");

export async function agentWorkflow(messages: ModelMessage[]) {
  "use workflow";

  const agent = new DurableAgent({
    model: "minimax/minimax-m2.7",
    instructions: AGENT_INSTRUCTIONS,
  });

  await agent.stream({
    messages,
    writable: getWritable<UIMessageChunk>(),
  });
}
