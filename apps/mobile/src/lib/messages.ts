import { hasNumberType, hasStringType } from "@autopr/config/runtime-type";
import { isJsonObject, type JsonObject } from "@autopr/config/runtime-value";

import { toolHeader } from "./toolPresentation";

export type MessagePartView =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "file"; url: string; mediaType: string; filename?: string }
  | {
      kind: "recording";
      id: string;
      title?: string;
      url?: string;
      durationSeconds?: number;
      status?: string;
    }
  | {
      kind: "tool";
      name: string;
      /** Bare tool slug, e.g. "edit". */
      slug: string;
      /** Leading header label — an action verb for file edits. */
      label: string;
      state?: string;
      /** Header line derived from the tool input. */
      summary?: string;
      /** File the tool acted on, when it names one. */
      path?: string;
      /** True until the tool reports a result. */
      streaming: boolean;
      /** Read-only tools collapse into one "Explored" group. */
      explore: boolean;
      details?: string;
      failed: boolean;
    };

function isRecord<ValueValue>(value: ValueValue): value is ValueValue & (JsonObject) {
  return isJsonObject(value);
}

function contentFromOutput<OutputValue>(output: OutputValue) {
  if (hasStringType(output)) return output;
  if (isRecord(output) && hasStringType(output.content)) return output.content;
  return undefined;
}

function readableToolDetails<InputValue, OutputValue, ErrorTextValue>(input: InputValue, output: OutputValue, errorText: ErrorTextValue) {
  const sections: string[] = [];
  const stringify = <ValueValue>(value: ValueValue) => {
    try {
      return JSON.stringify(value, (key, child) => {
        if (
          hasStringType(child)
          && (key === "data" || key === "base64" || child.length > 2_000)
        ) {
          return `${child.slice(0, 2_000)}${child.length > 2_000 ? "… [truncated]" : ""}`;
        }
        return child;
      }, 2);
    } catch {
      return String(value);
    }
  };
  if (input !== undefined) {
    sections.push(`### Input\n\n\`\`\`json\n${stringify(input)}\n\`\`\``);
  }
  if (output !== undefined) {
    const outputContent = contentFromOutput(output);
    sections.push(outputContent
      ? `### Output\n\n${outputContent}`
      : `### Output\n\n\`\`\`json\n${stringify(output)}\n\`\`\``);
  }
  if (hasStringType(errorText) && errorText.trim()) {
    sections.push(`### Error\n\n${errorText.trim()}`);
  }
  const value = sections.join("\n\n");
  return value ? value.slice(0, 12_000) : undefined;
}

type RecordingPart = Extract<MessagePartView, { kind: "recording" }>;

function recordingsFromValue<ValueValue>(value: ValueValue, seen = new Set<string>()): RecordingPart[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => recordingsFromValue(item, seen));
  }
  if (!isRecord(value)) return [];
  if (value.type === "daytona_recording" && hasStringType(value.id)) {
    if (seen.has(value.id)) return [];
    seen.add(value.id);
    return [{
      kind: "recording",
      id: value.id,
      title: hasStringType(value.title)
        ? value.title
        : hasStringType(value.fileName) ? value.fileName : undefined,
      url: hasStringType(value.url) ? value.url : undefined,
      durationSeconds: hasNumberType(value.durationSeconds) ? value.durationSeconds : undefined,
      status: hasStringType(value.status) ? value.status : undefined,
    }];
  }
  return Object.values(value).flatMap((child) => recordingsFromValue(child, seen));
}

export function messageParts(parts: readonly unknown[]): MessagePartView[] {
  return parts.flatMap((value): MessagePartView[] => {
    if (!isRecord(value) || !hasStringType(value.type)) return [];
    const type = String(value.type);
    if (type === "text" && hasStringType(value.text) && value.text.trim()) {
      return [{ kind: "text", text: value.text }];
    }
    if (type === "reasoning" && hasStringType(value.text) && value.text.trim()) {
      return [{ kind: "reasoning", text: value.text }];
    }
    if (
      type === "file" &&
      hasStringType(value.url) &&
      hasStringType(value.mediaType)
    ) {
      return [{
        kind: "file",
        url: value.url,
        mediaType: value.mediaType,
        filename: hasStringType(value.filename) ? value.filename : undefined,
      }];
    }
    if (type === "dynamic-tool" || type.startsWith("tool-")) {
      const toolName = hasStringType(value.toolName) ? value.toolName : undefined;
      const name = type === "dynamic-tool" && toolName
        ? toolName
        : type.slice("tool-".length);
      const errorText = hasStringType(value.errorText) ? value.errorText : undefined;
      const state = hasStringType(value.state) ? value.state : undefined;
      const failed = Boolean(errorText) || state === "output-error";
      const streaming = state === "input-streaming" || state === "input-available";
      const header = toolHeader({
        type,
        toolName,
        input: value.input,
        streaming,
        failed,
      });
      return [
        {
          kind: "tool",
          name,
          slug: header.slug,
          label: header.label,
          state,
          summary: errorText ?? header.summary,
          path: header.path,
          streaming,
          explore: header.explore,
          details: readableToolDetails(value.input, value.output, errorText),
          failed,
        },
        ...recordingsFromValue(value.output),
      ];
    }
    return [];
  });
}
