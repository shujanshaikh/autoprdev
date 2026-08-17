import { hasObjectType, hasStringType } from "@autopr/config/runtime-type";
import { type JsonObject } from "@autopr/config/runtime-value";

export type ThreadDisplayMessage = {
  messageId: string;
  role: string;
  parts: unknown[];
  metadata?: unknown;
  createdAt?: number;
  updatedAt?: number;
};

type ReconcileThreadMessagesOptions = {
  persistedMessages: ThreadDisplayMessage[];
  optimisticUserMessage: ThreadDisplayMessage | null;
  streamingAssistantMessage: ThreadDisplayMessage | null;
  allowPersistedPartRemoval: boolean;
};

const TERMINAL_TOOL_STATES = new Set([
  "output-available",
  "output-denied",
  "output-error",
]);

function recordPart<PartValue>(part: PartValue): JsonObject | null {
  return hasObjectType(part) && part !== null && !Array.isArray(part)
    ? /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ part as JsonObject
    : null;
}

function partType<PartValue>(part: PartValue) {
  const value = recordPart(part)?.type;
  return hasStringType(value) ? value : undefined;
}

function partState<PartValue>(part: PartValue) {
  const value = recordPart(part)?.state;
  return hasStringType(value) ? value : undefined;
}

function toolCallId<PartValue>(part: PartValue) {
  const value = recordPart(part)?.toolCallId;
  return hasStringType(value) ? value : undefined;
}

function isToolPart<PartValue>(part: PartValue) {
  const type = partType(part);
  return type === "dynamic-tool" || Boolean(type?.startsWith("tool-"));
}

function isIncompleteToolPart<PartValue>(part: PartValue) {
  return isToolPart(part) && !TERMINAL_TOOL_STATES.has(partState(part) ?? "");
}

function textPartValue<PartValue>(part: PartValue) {
  const value = recordPart(part);
  const type = partType(part);
  return value && (type === "text" || type === "reasoning") && hasStringType(value.text)
    ? value.text
    : undefined;
}

function isPersistedPartMoreComplete<CurrentPartValue, PersistedPartValue>(currentPart: CurrentPartValue, persistedPart: PersistedPartValue) {
  if (!currentPart) return false;

  const currentState = partState(currentPart);
  const persistedState = partState(persistedPart);
  if (
    isToolPart(persistedPart)
    && TERMINAL_TOOL_STATES.has(persistedState ?? "")
    && !TERMINAL_TOOL_STATES.has(currentState ?? "")
  ) {
    return true;
  }

  const persistedType = partType(persistedPart);
  if (
    (persistedType === "text" || persistedType === "reasoning")
    && persistedState === "done"
    && currentState === "streaming"
  ) {
    return true;
  }

  const currentText = textPartValue(currentPart);
  const persistedText = textPartValue(persistedPart);
  if (
    currentText !== undefined
    && persistedText !== undefined
    && persistedText !== currentText
    && persistedText.length >= currentText.length
    && persistedState !== "streaming"
  ) {
    return true;
  }

  const current = recordPart(currentPart);
  const persisted = recordPart(persistedPart);
  return Boolean(
    isToolPart(persistedPart)
    && persisted
    && current
    && (("output" in persisted && !("output" in current))
      || ("errorText" in persisted && !("errorText" in current))),
  );
}

/**
 * Keeps the most complete view of an assistant response while Convex catches
 * up with the live stream. This mirrors the web chat's reconciliation rules.
 */
export function mergePersistedAssistantParts(
  streamingParts: unknown[],
  persistedParts: unknown[],
  options: { allowPersistedRemoval?: boolean } = {},
) {
  if (persistedParts.length === 0) return streamingParts;
  if (persistedParts.length > streamingParts.length) return persistedParts;

  const streamingPartsByToolCallId = new Map<string, unknown>();
  for (const part of streamingParts) {
    const id = toolCallId(part);
    if (id) streamingPartsByToolCallId.set(id, part);
  }

  const persistedIsMoreComplete = persistedParts.some((persistedPart, index) => {
    const id = toolCallId(persistedPart);
    const streamingPart = id ? streamingPartsByToolCallId.get(id) : streamingParts[index];
    return isPersistedPartMoreComplete(streamingPart, persistedPart);
  });

  if (persistedIsMoreComplete) return persistedParts;

  if (
    options.allowPersistedRemoval
    && persistedParts.length < streamingParts.length
    && streamingParts.some(isIncompleteToolPart)
    && !persistedParts.some(isIncompleteToolPart)
  ) {
    return persistedParts;
  }

  return streamingParts;
}

export function reconcileThreadMessages({
  persistedMessages,
  optimisticUserMessage,
  streamingAssistantMessage,
  allowPersistedPartRemoval,
}: ReconcileThreadMessagesOptions) {
  const next = [...persistedMessages];

  if (
    optimisticUserMessage
    && !next.some((message) => message.messageId === optimisticUserMessage.messageId)
  ) {
    next.push(optimisticUserMessage);
  }

  if (!streamingAssistantMessage) return next;

  const persistedIndex = next.findIndex(
    (message) => message.messageId === streamingAssistantMessage.messageId,
  );
  if (persistedIndex < 0) {
    next.push(streamingAssistantMessage);
    return next;
  }

  const persistedMessage = next[persistedIndex];
  if (!persistedMessage) return next;

  next[persistedIndex] = {
    ...streamingAssistantMessage,
    ...persistedMessage,
    parts: mergePersistedAssistantParts(
      streamingAssistantMessage.parts,
      persistedMessage.parts,
      { allowPersistedRemoval: allowPersistedPartRemoval },
    ),
    metadata: persistedMessage.metadata ?? streamingAssistantMessage.metadata,
  };

  return next;
}
