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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contentFromOutput(output: unknown) {
  if (typeof output === "string") return output;
  if (isRecord(output) && typeof output.content === "string") return output.content;
  return undefined;
}

function readableToolDetails(input: unknown, output: unknown, errorText: unknown) {
  const sections: string[] = [];
  const stringify = (value: unknown) => {
    try {
      return JSON.stringify(value, (key, child) => {
        if (
          typeof child === "string"
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
  if (typeof errorText === "string" && errorText.trim()) {
    sections.push(`### Error\n\n${errorText.trim()}`);
  }
  const value = sections.join("\n\n");
  return value ? value.slice(0, 12_000) : undefined;
}

type RecordingPart = Extract<MessagePartView, { kind: "recording" }>;

function recordingsFromValue(value: unknown, seen = new Set<string>()): RecordingPart[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => recordingsFromValue(item, seen));
  }
  if (!isRecord(value)) return [];
  if (value.type === "daytona_recording" && typeof value.id === "string") {
    if (seen.has(value.id)) return [];
    seen.add(value.id);
    return [{
      kind: "recording",
      id: value.id,
      title: typeof value.title === "string"
        ? value.title
        : typeof value.fileName === "string" ? value.fileName : undefined,
      url: typeof value.url === "string" ? value.url : undefined,
      durationSeconds: typeof value.durationSeconds === "number" ? value.durationSeconds : undefined,
      status: typeof value.status === "string" ? value.status : undefined,
    }];
  }
  return Object.values(value).flatMap((child) => recordingsFromValue(child, seen));
}

export function messageParts(parts: readonly unknown[]): MessagePartView[] {
  return parts.flatMap((value): MessagePartView[] => {
    if (!isRecord(value) || typeof value.type !== "string") return [];
    if (value.type === "text" && typeof value.text === "string" && value.text.trim()) {
      return [{ kind: "text", text: value.text }];
    }
    if (value.type === "reasoning" && typeof value.text === "string" && value.text.trim()) {
      return [{ kind: "reasoning", text: value.text }];
    }
    if (
      value.type === "file" &&
      typeof value.url === "string" &&
      typeof value.mediaType === "string"
    ) {
      return [{
        kind: "file",
        url: value.url,
        mediaType: value.mediaType,
        filename: typeof value.filename === "string" ? value.filename : undefined,
      }];
    }
    if (value.type === "dynamic-tool" || value.type.startsWith("tool-")) {
      const toolName = typeof value.toolName === "string" ? value.toolName : undefined;
      const name = value.type === "dynamic-tool" && toolName
        ? toolName
        : value.type.slice("tool-".length);
      const errorText = typeof value.errorText === "string" ? value.errorText : undefined;
      const state = typeof value.state === "string" ? value.state : undefined;
      const failed = Boolean(errorText) || state === "output-error";
      const streaming = state === "input-streaming" || state === "input-available";
      const header = toolHeader({
        type: value.type,
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
