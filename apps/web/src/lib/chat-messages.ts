import { hasStringType } from "@autopr/config/runtime-type";
import { isJsonObject, type JsonObject, type JsonValue } from "@autopr/config/runtime-value";
import { isToolUIPart, type ModelMessage, type UIMessage } from "ai";
import { compactAssistantPartsForModel } from "./agent-message-compaction";

export type StoredMessageRow = {
  messageId: string;
  role: "system" | "user" | "assistant";
  parts: UIMessage["parts"];
  partsR2Key?: string;
  partsBlobContentType?: string;
  partsBlobSizeBytes?: number;
  partsBlobSha256?: string;
  metadata?: unknown;
  updatedAt?: number;
};

export function toUIMessage(row: StoredMessageRow): UIMessage {
  return {
    id: row.messageId,
    role: row.role,
    parts: row.parts,
    metadata: row.metadata,
  };
}

function isRecord<ValueValue>(value: ValueValue): value is ValueValue & (JsonObject) {
  return isJsonObject(value);
}

function toolNameFromPart(part: UIMessage["parts"][number]): string | undefined {
  if (part.type === "dynamic-tool" && "toolName" in part) {
    return hasStringType(part.toolName) ? part.toolName : undefined;
  }

  return part.type.startsWith("tool-")
    ? part.type.slice("tool-".length)
    : undefined;
}

export const COMPUTER_METADATA_PREFIX = "AUTOPR_COMPUTER_METADATA ";

const SCREENSHOT_PAYLOAD_KEYS = new Set(["base64", "data", "image", "screenshot"]);
const MIN_SCREENSHOT_PAYLOAD_CHARS = 1024;

function shouldStripScreenshotPayload(key: string, value: string, isScreenshotContext: boolean) {
  return (
    isScreenshotContext &&
    SCREENSHOT_PAYLOAD_KEYS.has(key.toLowerCase()) &&
    (value.length >= MIN_SCREENSHOT_PAYLOAD_CHARS || value.startsWith("data:image/"))
  );
}

function sanitizeScreenshotPayloads<ValueValue>(value: ValueValue, isScreenshotContext = false): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeScreenshotPayloads(item, isScreenshotContext));
  }

  if (!isRecord(value)) {
    return value;
  }

  let strippedPayload = false;
  const next: JsonObject = {};

  for (const [key, child] of Object.entries(value)) {
    const childIsScreenshotContext = isScreenshotContext || key.toLowerCase().includes("screenshot");

    if (hasStringType(child) && shouldStripScreenshotPayload(key, child, childIsScreenshotContext)) {
      next[key] = {
        omitted: true,
        base64Length: child.length,
      };
      strippedPayload = true;
      continue;
    }

    next[key] = sanitizeScreenshotPayloads(child, childIsScreenshotContext);
  }

  if (strippedPayload && isScreenshotContext) {
    next.payloadStripped = true;
  }

  return next;
}

export interface DemoRecordingMetadata {
  type: "daytona_recording";
  id: string;
  title?: string;
  fileName?: string;
  filePath?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
  durationSeconds?: number;
  sizeBytes?: number;
  url?: string;
  contentType?: string;
}

export function isDemoRecordingMetadata<ValueValue>(value: ValueValue): value is ValueValue & (DemoRecordingMetadata) {
  return (
    isRecord(value) &&
    value.type === "daytona_recording" &&
    hasStringType(value.id)
  );
}

function isContentDetailsOutput<ValueValue>(
  value: ValueValue,
): value is ValueValue & ({ content: string; details: JsonObject }) {
  return isRecord(value) && hasStringType(value.content) && isRecord(value.details);
}

function parseComputerMetadata(text: string): JsonObject | null {
  if (!text.startsWith(COMPUTER_METADATA_PREFIX)) {
    return null;
  }

  try {
    const parsed = JSON.parse(text.slice(COMPUTER_METADATA_PREFIX.length));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function imageContentPart<ValueValue>(value: ValueValue): { data: string; mediaType: string } | null {
  if (!isRecord(value) || !hasStringType(value.data)) {
    return null;
  }

  if (value.type === "image-data" && hasStringType(value.mediaType)) {
    return { data: value.data, mediaType: value.mediaType };
  }

  if (value.type === "media" && hasStringType(value.mediaType) && value.mediaType.startsWith("image/")) {
    return { data: value.data, mediaType: value.mediaType };
  }

  return null;
}

export function computerContentOutputToContentDetails<OutputValue>(
  output: OutputValue,
): { content: string; details: JsonObject } | null {
  if (isContentDetailsOutput(output)) {
    return output;
  }

  const contentItems = Array.isArray(output)
    ? output
    : isRecord(output) && output.type === "content" && Array.isArray(output.value)
      ? output.value
      : null;

  if (!contentItems) {
    return null;
  }

  const content: string[] = [];
  let details: JsonObject | null = null;
  let screenshotImage: { data: string; mediaType: string } | null = null;

  for (const item of contentItems) {
    if (isRecord(item) && item.type === "text" && hasStringType(item.text)) {
      const metadata = parseComputerMetadata(item.text);
      if (metadata) {
        details = metadata;
      } else {
        content.push(item.text);
      }
      continue;
    }

    screenshotImage ??= imageContentPart(item);
  }

  if (!details) {
    return null;
  }

  if (screenshotImage) {
    const screenshot = isRecord(details.screenshot) ? details.screenshot : {};
    details = {
      ...details,
      screenshot: {
        ...screenshot,
        data: screenshotImage.data,
        mimeType: screenshotImage.mediaType,
      },
    };
  }

  return {
    content: content.join("\n").trim() || "Computer action completed.",
    details,
  };
}

function normalizeComputerOutput<OutputValue>(output: OutputValue): JsonValue {
  return computerContentOutputToContentDetails(output) ?? output;
}

function collectDemoRecordings<ValueValue>(
  value: ValueValue,
  recordings: DemoRecordingMetadata[],
  seenRecordingIds = new Set<string>(),
) {
  if (isDemoRecordingMetadata(value)) {
    if (!seenRecordingIds.has(value.id)) {
      seenRecordingIds.add(value.id);
      recordings.push(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectDemoRecordings(item, recordings, seenRecordingIds);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const child of Object.values(value)) {
    collectDemoRecordings(child, recordings, seenRecordingIds);
  }
}

export function findDemoRecordingMetadataInParts(
  parts: UIMessage["parts"],
  recordingId: string,
): DemoRecordingMetadata | null {
  for (const part of parts) {
    if (toolNameFromPart(part) !== "computer" || !("output" in part)) {
      continue;
    }

    const recordings: DemoRecordingMetadata[] = [];
    collectDemoRecordings(normalizeComputerOutput(part.output), recordings);

    for (const recording of recordings) {
      if (recording.id === recordingId) {
        return recording;
      }
    }
  }

  return null;
}

export function sanitizeAssistantPartsForPersistence(parts: UIMessage["parts"]): UIMessage["parts"] {
  return parts.map((part) => {
    if (toolNameFromPart(part) !== "computer" || !("output" in part)) {
      return part;
    }

    return /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ {
      ...part,
      output: sanitizeScreenshotPayloads(normalizeComputerOutput(part.output)),
    } as UIMessage["parts"][number];
  });
}

function isCompleteToolPart(part: UIMessage["parts"][number]) {
  return (
    isToolUIPart(part) &&
    "state" in part &&
    TERMINAL_TOOL_STATES.has(part.state)
  );
}

function normalizeStoppedAssistantPart(part: UIMessage["parts"][number]): UIMessage["parts"][number] | null {
  if (isToolUIPart(part)) {
    return isCompleteToolPart(part) ? part : null;
  }

  if ((part.type === "text" || part.type === "reasoning") && "state" in part && part.state === "streaming") {
    return {
      ...part,
      state: "done",
    };
  }

  return part;
}

function trimDanglingStepStarts(parts: UIMessage["parts"]) {
  const trimmed = [...parts];

  while (trimmed.at(-1)?.type === "step-start") {
    trimmed.pop();
  }

  return trimmed;
}

export function sanitizeStoppedAssistantParts(parts: UIMessage["parts"]): UIMessage["parts"] {
  return sanitizeAssistantPartsForPersistence(
    trimDanglingStepStarts(parts.flatMap((part) => {
      const normalizedPart = normalizeStoppedAssistantPart(part);
      return normalizedPart ? [normalizedPart] : [];
    })),
  );
}

export function sanitizeMessageForModelConversion(message: UIMessage): UIMessage {
  if (message.role !== "assistant") {
    return message;
  }

  return {
    ...message,
    parts: compactAssistantPartsForModel(sanitizeStoppedAssistantParts(message.parts)),
  };
}

const TERMINAL_TOOL_STATES = new Set([
  "output-available",
  "output-denied",
  "output-error",
]);

function partState(part: UIMessage["parts"][number]): string | undefined {
  return "state" in part && hasStringType(part.state) ? part.state : undefined;
}

function toolCallId(part: UIMessage["parts"][number]): string | undefined {
  return "toolCallId" in part && hasStringType(part.toolCallId)
    ? part.toolCallId
    : undefined;
}

function isToolPartLike(part: UIMessage["parts"][number]) {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function isIncompleteToolPart(part: UIMessage["parts"][number]) {
  return isToolPartLike(part) && !TERMINAL_TOOL_STATES.has(partState(part) ?? "");
}

function textPartValue(part: UIMessage["parts"][number] | undefined) {
  if (!part || (part.type !== "text" && part.type !== "reasoning")) {
    return undefined;
  }

  return part.text;
}

function isPersistedPartMoreComplete(
  currentPart: UIMessage["parts"][number] | undefined,
  persistedPart: UIMessage["parts"][number],
) {
  if (!currentPart) {
    return false;
  }

  const currentState = partState(currentPart);
  const persistedState = partState(persistedPart);
  if (
    isToolPartLike(persistedPart) &&
    TERMINAL_TOOL_STATES.has(persistedState ?? "") &&
    !TERMINAL_TOOL_STATES.has(currentState ?? "")
  ) {
    return true;
  }

  if (
    (persistedPart.type === "text" || persistedPart.type === "reasoning") &&
    persistedState === "done" &&
    currentState === "streaming"
  ) {
    return true;
  }

  const currentText = textPartValue(currentPart);
  const persistedText = textPartValue(persistedPart);
  if (
    currentText !== undefined &&
    persistedText !== undefined &&
    persistedText !== currentText &&
    persistedText.length >= currentText.length &&
    persistedState !== "streaming"
  ) {
    return true;
  }

  return (
    isToolPartLike(persistedPart) &&
    (("output" in persistedPart && !("output" in currentPart)) ||
      ("errorText" in persistedPart && !("errorText" in currentPart)))
  );
}

export function mergePersistedAssistantParts(
  currentParts: UIMessage["parts"],
  persistedParts: UIMessage["parts"],
  options: { allowPersistedRemoval?: boolean } = {},
): UIMessage["parts"] {
  if (persistedParts.length === 0) {
    return currentParts;
  }

  if (persistedParts.length > currentParts.length) {
    return persistedParts;
  }

  const currentPartsByToolCallId = new Map<string, UIMessage["parts"][number]>();
  for (const part of currentParts) {
    const id = toolCallId(part);
    if (id) {
      currentPartsByToolCallId.set(id, part);
    }
  }

  const persistedIsMoreComplete = persistedParts.some((persistedPart, index) => {
    const id = toolCallId(persistedPart);
    const currentPart = id ? currentPartsByToolCallId.get(id) : currentParts[index];

    return isPersistedPartMoreComplete(currentPart, persistedPart);
  });

  if (persistedIsMoreComplete) {
    return persistedParts;
  }

  if (
    options.allowPersistedRemoval &&
    persistedParts.length < currentParts.length &&
    currentParts.some(isIncompleteToolPart) &&
    !persistedParts.some(isIncompleteToolPart)
  ) {
    return persistedParts;
  }

  return currentParts;
}

function getFilePartUrl<DataValue>(data: DataValue) {
  if (hasStringType(data)) {
    return data;
  }

  if (data instanceof URL) {
    return data.toString();
  }

  return null;
}

function formatToolResultError<ValueValue>(value: ValueValue) {
  if (hasStringType(value)) {
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

  const toolOutput = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ result.output as { type?: string; value?: unknown; reason?: string };
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

      if (hasStringType(message.content)) {
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

  return sanitizeAssistantPartsForPersistence(parts);
}
