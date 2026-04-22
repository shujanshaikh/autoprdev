import type { ModelMessage, UIMessage } from "ai";

export type StoredMessageRow = {
  messageId: string;
  role: "system" | "user" | "assistant";
  parts: UIMessage["parts"];
  metadata?: unknown;
};

export function toUIMessage(row: StoredMessageRow): UIMessage {
  return {
    id: row.messageId,
    role: row.role,
    parts: row.parts,
    metadata: row.metadata,
  };
}

function getFilePartUrl(data: unknown) {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof URL) {
    return data.toString();
  }

  return null;
}

function formatToolResultError(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Tool execution failed.";
  }
}

function applyToolResultToParts(
  parts: UIMessage["parts"],
  toolPartIndexes: Map<string, number>,
  result: { toolCallId: string; toolName: string; output: unknown },
) {
  const existingIndex = toolPartIndexes.get(result.toolCallId);
  const existingPart = existingIndex === undefined ? null : parts[existingIndex];
  const input =
    existingPart && existingPart.type === "dynamic-tool" && "input" in existingPart ? existingPart.input : undefined;

  const toolOutput = result.output as { type?: string; value?: unknown; reason?: string };
  const nextPart: UIMessage["parts"][number] =
    toolOutput?.type === "error-text" || toolOutput?.type === "error-json" || toolOutput?.type === "execution-denied"
      ? {
          type: "dynamic-tool",
          toolName: result.toolName,
          toolCallId: result.toolCallId,
          input,
          state: "output-error",
          errorText:
            toolOutput.type === "execution-denied"
              ? toolOutput.reason ?? "Tool execution denied."
              : formatToolResultError(toolOutput.value),
        }
      : {
          type: "dynamic-tool",
          toolName: result.toolName,
          toolCallId: result.toolCallId,
          input,
          state: "output-available",
          output:
            toolOutput?.type === "text" || toolOutput?.type === "json" || toolOutput?.type === "content"
              ? toolOutput.value
              : result.output,
        };

  if (existingIndex === undefined) {
    toolPartIndexes.set(result.toolCallId, parts.length);
    parts.push(nextPart);
    return;
  }

  parts[existingIndex] = nextPart;
}

export function responseMessagesToAssistantParts(messages: ModelMessage[], startIndex = 0): UIMessage["parts"] {
  const parts: UIMessage["parts"] = [];
  const toolPartIndexes = new Map<string, number>();

  for (const message of messages.slice(startIndex)) {
    if (message.role === "assistant") {
      if (parts.length > 0) {
        parts.push({ type: "step-start" });
      }

      if (typeof message.content === "string") {
        if (message.content) {
          parts.push({
            type: "text",
            text: message.content,
            state: "done",
          });
        }

        continue;
      }

      for (const part of message.content) {
        if (part.type === "text") {
          parts.push({
            type: "text",
            text: part.text,
            state: "done",
          });
          continue;
        }

        if (part.type === "reasoning") {
          parts.push({
            type: "reasoning",
            text: part.text,
            state: "done",
          });
          continue;
        }

        if (part.type === "file") {
          const url = getFilePartUrl(part.data);

          if (url) {
            parts.push({
              type: "file",
              url,
              mediaType: part.mediaType,
              filename: part.filename,
            });
          }

          continue;
        }

        if (part.type === "tool-call") {
          toolPartIndexes.set(part.toolCallId, parts.length);
          parts.push({
            type: "dynamic-tool",
            toolName: part.toolName,
            toolCallId: part.toolCallId,
            input: part.input,
            state: "input-available",
            providerExecuted: part.providerExecuted,
          });
          continue;
        }

        if (part.type === "tool-result") {
          applyToolResultToParts(parts, toolPartIndexes, part);
          continue;
        }

        if (part.type === "tool-approval-request") {
          const existingIndex = toolPartIndexes.get(part.toolCallId);
          const existingPart = existingIndex === undefined ? null : parts[existingIndex];

          if (existingIndex !== undefined && existingPart && existingPart.type === "dynamic-tool" && "input" in existingPart) {
            parts[existingIndex] = {
              type: "dynamic-tool",
              toolName: existingPart.toolName,
              toolCallId: existingPart.toolCallId,
              input: existingPart.input,
              state: "approval-requested",
              approval: {
                id: part.approvalId,
              },
            };
          }
        }
      }

      continue;
    }

    if (message.role === "tool") {
      for (const part of message.content) {
        if (part.type === "tool-result") {
          applyToolResultToParts(parts, toolPartIndexes, part);
        }
      }
    }
  }

  return parts;
}
