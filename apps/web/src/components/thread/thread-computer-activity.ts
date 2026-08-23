import { hasStringType } from "@autopr/config/runtime-type";
import { getToolName, isToolUIPart, type UIMessage } from "ai";

import { toolSlugFromPart } from "@/components/ai-elements/tool";

const ACTIVE_COMPUTER_STATES = new Set(["input-streaming", "input-available"]);

function computerToolCallId(message: UIMessage, index: number) {
  const part = message.parts[index];
  if (!part || !isToolUIPart(part)) {
    return undefined;
  }

  const toolName = part.type === "dynamic-tool" ? getToolName(part) : undefined;
  if (toolSlugFromPart(part.type, toolName) !== "computer") {
    return undefined;
  }

  return "toolCallId" in part && hasStringType(part.toolCallId)
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

/** Returns the active CUA tool call in a streaming assistant message, if one exists. */
export function activeComputerToolCallId(message: UIMessage | undefined): string | undefined {
  if (message?.role !== "assistant") {
    return undefined;
  }

  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    const toolCallId = computerToolCallId(message, index);
    if (!part || !toolCallId) continue;

    const state = "state" in part && hasStringType(part.state) ? part.state : undefined;
    if (state && ACTIVE_COMPUTER_STATES.has(state)) {
      return toolCallId;
    }
  }

  return undefined;
}
