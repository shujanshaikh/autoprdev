export const MAX_COMMAND_OUTPUT_CHARS = 20_000;
export const MAX_FILE_OUTPUT_CHARS = 20_000;

export function combineCommandOutput(stdout?: string, stderr?: string): string {
  if (stdout && stderr) {
    const separator = stdout.endsWith("\n") || stderr.startsWith("\n") ? "" : "\n";
    return `${stdout}${separator}${stderr}`;
  }

  return stdout ?? stderr ?? "";
}

export function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, maxChars)}\n... output truncated ...`,
    truncated: true,
  };
}

export function clampLimit(limit: number | undefined, defaultLimit: number, maxLimit: number): number {
  if (!limit || limit < 1) {
    return defaultLimit;
  }

  return Math.min(limit, maxLimit);
}

export function formatNumberedLines(lines: string[], startLine: number): string {
  return lines.map((line, index) => `${startLine + index} | ${line}`).join("\n");
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_000));

  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
  }

  return false;
}

export interface ToolTextOutput<DETAILS extends Record<string, unknown> = Record<string, unknown>> {
  content: string;
  details: DETAILS;
}

export function toTextModelOutput(output: unknown) {
  const value =
    typeof output === "object" && output !== null && "content" in output && typeof output.content === "string"
      ? output.content
      : JSON.stringify(output);

  return {
    type: "text" as const,
    value: value ?? "",
  };
}
