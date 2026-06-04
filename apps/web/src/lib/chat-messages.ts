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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dynamicToolName(part: UIMessage["parts"][number]): string | undefined {
  if (part.type !== "dynamic-tool" || !("toolName" in part)) {
    return undefined;
  }

  return typeof part.toolName === "string" ? part.toolName : undefined;
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

function sanitizeScreenshotPayloads(value: unknown, isScreenshotContext = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeScreenshotPayloads(item, isScreenshotContext));
  }

  if (!isRecord(value)) {
    return value;
  }

  let strippedPayload = false;
  const next: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    const childIsScreenshotContext = isScreenshotContext || key.toLowerCase().includes("screenshot");

    if (typeof child === "string" && shouldStripScreenshotPayload(key, child, childIsScreenshotContext)) {
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

export function isDemoRecordingMetadata(value: unknown): value is DemoRecordingMetadata {
  return (
    isRecord(value) &&
    value.type === "daytona_recording" &&
    typeof value.id === "string"
  );
}

function isContentDetailsOutput(
  value: unknown,
): value is { content: string; details: Record<string, unknown> } {
  return isRecord(value) && typeof value.content === "string" && isRecord(value.details);
}

function parseComputerMetadata(text: string): Record<string, unknown> | null {
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

function imageContentPart(value: unknown): { data: string; mediaType: string } | null {
  if (!isRecord(value) || typeof value.data !== "string") {
    return null;
  }

  if (value.type === "image-data" && typeof value.mediaType === "string") {
    return { data: value.data, mediaType: value.mediaType };
  }

  if (value.type === "media" && typeof value.mediaType === "string" && value.mediaType.startsWith("image/")) {
    return { data: value.data, mediaType: value.mediaType };
  }

  return null;
}

export function computerContentOutputToContentDetails(
  output: unknown,
): { content: string; details: Record<string, unknown> } | null {
  if (isContentDetailsOutput(output)) {
    return output;
  }

  if (!Array.isArray(output)) {
    return null;
  }

  const content: string[] = [];
  let details: Record<string, unknown> | null = null;
  let screenshotImage: { data: string; mediaType: string } | null = null;

  for (const item of output) {
    if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
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

function normalizeComputerOutput(output: unknown): unknown {
  return computerContentOutputToContentDetails(output) ?? output;
}

function collectDemoRecordings(
  value: unknown,
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
    if (dynamicToolName(part) !== "computer" || !("output" in part)) {
      continue;
    }

    const recordings: DemoRecordingMetadata[] = [];
    collectDemoRecordings(normalizeComputerOutput(part.output), recordings);
    const match = recordings.find((recording) => recording.id === recordingId);

    if (match) {
      return match;
    }
  }

  return null;
}

export function sanitizeAssistantPartsForPersistence(parts: UIMessage["parts"]): UIMessage["parts"] {
  return parts.map((part) => {
    if (dynamicToolName(part) !== "computer" || !("output" in part)) {
      return part;
    }

    return {
      ...part,
      output: sanitizeScreenshotPayloads(normalizeComputerOutput(part.output)),
    } as UIMessage["parts"][number];
  });
}

function isCompleteToolPart(part: UIMessage["parts"][number]) {
  return (
    part.type === "dynamic-tool" &&
    "state" in part &&
    (part.state === "output-available" || part.state === "output-error")
  );
}

function normalizeStoppedAssistantPart(part: UIMessage["parts"][number]): UIMessage["parts"][number] | null {
  if (part.type === "dynamic-tool") {
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
    parts: sanitizeStoppedAssistantParts(message.parts),
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

  return sanitizeAssistantPartsForPersistence(parts);
}
