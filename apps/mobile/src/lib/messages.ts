export type MessagePartView =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "file"; url: string; mediaType: string; filename?: string }
  | { kind: "tool"; name: string; state?: string; summary?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contentFromOutput(output: unknown) {
  if (typeof output === "string") return output;
  if (isRecord(output) && typeof output.content === "string") return output.content;
  return undefined;
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
      const name = value.type === "dynamic-tool" && typeof value.toolName === "string"
        ? value.toolName
        : value.type.slice("tool-".length);
      return [{
        kind: "tool",
        name,
        state: typeof value.state === "string" ? value.state : undefined,
        summary: contentFromOutput(value.output),
      }];
    }
    return [];
  });
}
