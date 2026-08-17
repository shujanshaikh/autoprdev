import { getToolName, isToolUIPart, type UIMessage } from "ai";

import { toolSlugFromPart } from "@/components/ai-elements/tool";

const ACTIVE_COMPUTER_STATES = new Set(["input-streaming", "input-available"]);

/** Returns the active CUA tool call in a streaming assistant message, if one exists. */
export function activeComputerToolCallId(message: UIMessage | undefined): string | undefined {
  if (message?.role !== "assistant") {
    return undefined;
  }

  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    if (!part || !isToolUIPart(part)) {
      continue;
    }

    const toolName = part.type === "dynamic-tool" ? getToolName(part) : undefined;
    const state = "state" in part && typeof part.state === "string" ? part.state : undefined;

    if (
      toolSlugFromPart(part.type, toolName) === "computer"
      && state
      && ACTIVE_COMPUTER_STATES.has(state)
    ) {
      return "toolCallId" in part && typeof part.toolCallId === "string"
        ? part.toolCallId
        : `${message.id}:${index}`;
    }
  }

  return undefined;
}
