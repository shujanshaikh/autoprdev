export const MAX_FILE_OUTPUT_CHARS = 20_000;
export const MAX_COMMAND_OUTPUT_BYTES = 50 * 1024;
export const MAX_COMMAND_OUTPUT_LINES = 2_000;

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

export interface TruncatedToolOutput {
  text: string;
  truncated: boolean;
  truncatedBy: "bytes" | "lines" | null;
  totalBytes: number;
  totalLines: number;
  outputBytes: number;
  outputLines: number;
}

/**
 * Bound command-like output by UTF-8 bytes and complete lines. Tail mode keeps
 * the final diagnostics that normally explain a failed command.
 */
export function truncateToolOutput(
  text: string,
  options: {
    direction?: "head" | "tail";
    maxBytes?: number;
    maxLines?: number;
  } = {},
): TruncatedToolOutput {
  const direction = options.direction ?? "head";
  const maxBytes = Math.max(1, Math.floor(options.maxBytes ?? MAX_COMMAND_OUTPUT_BYTES));
  const maxLines = Math.max(1, Math.floor(options.maxLines ?? MAX_COMMAND_OUTPUT_LINES));
  const totalBytes = Buffer.byteLength(text, "utf8");
  const lines = splitOutputLines(text);
  const totalLines = lines.length;

  if (totalBytes <= maxBytes && totalLines <= maxLines) {
    return {
      text,
      truncated: false,
      truncatedBy: null,
      totalBytes,
      totalLines,
      outputBytes: totalBytes,
      outputLines: totalLines,
    };
  }

  const selected: string[] = [];
  let selectedBytes = 0;
  let truncatedBy: "bytes" | "lines" = totalLines > maxLines ? "lines" : "bytes";
  const indexes = direction === "head"
    ? Array.from({ length: Math.min(lines.length, maxLines) }, (_, index) => index)
    : Array.from(
        { length: Math.min(lines.length, maxLines) },
        (_, index) => lines.length - 1 - index,
      );

  for (const index of indexes) {
    const line = lines[index] ?? "";
    const separatorBytes = selected.length > 0 ? 1 : 0;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (selectedBytes + separatorBytes + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      if (selected.length === 0) {
        selected.push(truncateUtf8(line, maxBytes, direction));
      }
      break;
    }

    if (direction === "head") selected.push(line);
    else selected.unshift(line);
    selectedBytes += separatorBytes + lineBytes;
  }

  const preview = selected.join("\n");
  const omitted = truncatedBy === "bytes"
    ? `${Math.max(0, totalBytes - Buffer.byteLength(preview, "utf8"))} bytes`
    : `${Math.max(0, totalLines - selected.length)} lines`;
  const marker = `... ${omitted} truncated; showing ${direction} ...`;
  const output = direction === "head"
    ? `${preview}${preview ? "\n" : ""}${marker}`
    : `${marker}${preview ? `\n${preview}` : ""}`;

  return {
    text: output,
    truncated: true,
    truncatedBy,
    totalBytes,
    totalLines,
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputLines: splitOutputLines(output).length,
  };
}

function splitOutputLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

function truncateUtf8(text: string, maxBytes: number, direction: "head" | "tail") {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) return text;

  if (direction === "head") {
    let end = maxBytes;
    while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end -= 1;
    return buffer.subarray(0, end).toString("utf8");
  }

  let start = buffer.length - maxBytes;
  while (start < buffer.length && (buffer[start]! & 0xc0) === 0x80) start += 1;
  return buffer.subarray(start).toString("utf8");
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
  if (completeUtf8PrefixLength(sample) === -1) return true;

  let suspiciousBytes = 0;
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
    if (byte < 7 || (byte > 13 && byte < 32)) suspiciousBytes += 1;
  }

  return sample.length > 0 && suspiciousBytes / sample.length > 0.3;
}

/** Returns a valid UTF-8 prefix, allowing only an incomplete final code point. */
export function completeUtf8PrefixLength(buffer: Buffer): number {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return buffer.length;
  } catch {
    // Only a well-formed prefix of a multibyte sequence may be incomplete.
  }

  const earliestPossibleLead = Math.max(0, buffer.length - 3);
  for (let start = earliestPossibleLead; start < buffer.length; start += 1) {
    const lead = buffer[start]!;
    const expectedLength = utf8SequenceLength(lead);
    const availableLength = buffer.length - start;
    if (expectedLength === 0 || expectedLength <= availableLength) continue;
    if (!isValidUtf8SequencePrefix(buffer.subarray(start), lead)) continue;

    try {
      new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, start));
      return start;
    } catch {
      // Invalid bytes occurred before the possible incomplete suffix.
    }
  }
  return -1;
}

function utf8SequenceLength(lead: number): number {
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 0;
}

function isValidUtf8SequencePrefix(suffix: Buffer, lead: number): boolean {
  for (let index = 1; index < suffix.length; index += 1) {
    const byte = suffix[index]!;
    if (byte < 0x80 || byte > 0xbf) return false;
    if (index !== 1) continue;
    if (lead === 0xe0 && byte < 0xa0) return false;
    if (lead === 0xed && byte > 0x9f) return false;
    if (lead === 0xf0 && byte < 0x90) return false;
    if (lead === 0xf4 && byte > 0x8f) return false;
  }
  return true;
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
