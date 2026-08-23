import { getToolName, isToolUIPart, type UIMessage } from "ai";

import { toolSlugFromPart } from "@/components/ai-elements/tool";

function computerToolCallId(message: UIMessage, index: number) {
  const part = message.parts[index];
  if (!part || !isToolUIPart(part)) {
    return undefined;
  }

  const toolName = part.type === "dynamic-tool" ? getToolName(part) : undefined;
  if (toolSlugFromPart(part.type, toolName) !== "computer") {
    return undefined;
  }

  return "toolCallId" in part && typeof part.toolCallId === "string"
    ? part.toolCallId
    : `${message.id}:${index}`;
}

/** Returns the latest CUA tool call in an assistant message, regardless of state. */
export function latestComputerToolCallId(message: UIMessage | undefined): string | undefined {
  if (message?.role !== "assistant") {
    return undefined;
  }

  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const toolCallId = computerToolCallId(message, index);
    if (toolCallId) return toolCallId;
  }

  return undefined;
}

/** Returns a CUA call only while its assistant turn is currently running. */
export function activeThreadComputerToolCallId(
  messages: readonly UIMessage[],
  activeAssistantMessageId: string | undefined,
): string | undefined {
  if (!activeAssistantMessageId) return undefined;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.id === activeAssistantMessageId) {
      return latestComputerToolCallId(message);
    }
  }

  return undefined;
}
