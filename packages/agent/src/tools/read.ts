import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { downloadRemoteFileChunk, resolveJailedSandboxPath } from "../sandbox/execute";
import {
  clampLimit,
  completeUtf8PrefixLength,
  formatNumberedLines,
  formatSize,
  isProbablyBinary,
  toTextModelOutput,
} from "./format";
import { requireString } from "./validation";

const DEFAULT_READ_LIMIT = 2_000;
const MAX_READ_LIMIT = 2_000;
// Hard cap on bytes transferred per read, enforced on the sandbox host before
// anything reaches harness memory. This mirrors the proven OpenCode/pi prompt
// budget while byteOffset still lets the model continue a minified long line.
const MAX_READ_WINDOW_BYTES = 64 * 1024;

const readInputSchema = z.object({
  path: z
    .string()
    .max(4_096)
    .optional()
    .describe("Required. Path to the file to read. Relative paths resolve from the sandbox workdir."),
  offset: z.number().int().min(1).optional().describe("Line number to start reading from. Uses 1-based indexing."),
  limit: z.number().int().min(1).max(MAX_READ_LIMIT).optional().describe(
    `Maximum number of lines to return, up to ${MAX_READ_LIMIT}.`,
  ),
  byteOffset: z.number().int().min(0).optional().describe(
    "Byte offset within the requested line. Use only when a previous read says a single oversized line is incomplete.",
  ),
});

type ReadInput = z.infer<typeof readInputSchema>;

async function executeDaytonaRead(input: ReadInput, sandboxOptions: SandboxSessionOptions) {
  const path = requireString(input.path, "path", "read");
  const context = await getSandboxContext(sandboxOptions);
  const remotePath = await resolveJailedSandboxPath(path, {
    workDir: context.workDir,
    sandboxOptions,
  });
  const offset = Math.max(1, input.offset ?? 1);
  const byteOffset = input.byteOffset ?? 0;
  const limit = clampLimit(input.limit, DEFAULT_READ_LIMIT, MAX_READ_LIMIT);
  // Only the requested line window leaves the sandbox host, and it is byte-capped
  // there, so a multi-GB artifact can no longer OOM the harness on a single read.
  const chunk = await downloadRemoteFileChunk({
    remotePath,
    maxBytes: MAX_READ_WINDOW_BYTES,
    startLine: offset,
    endLine: byteOffset > 0 ? offset : offset + limit - 1,
    skipBytes: byteOffset,
    countLines: true,
    sandboxOptions,
  });

  if (isProbablyBinary(chunk.content)) {
    return {
      content: `Cannot display ${remotePath} as text because it appears to be binary.`,
      details: {
        path: remotePath,
        bytes: chunk.totalBytes,
        lineOffset: offset,
        linesReturned: 0,
        totalLines: 0,
        truncated: false,
        isBinary: true,
      },
    };
  }

  // `wc -l` counts newlines; the previous whole-file split always produced
  // newlineCount + 1 entries (a trailing newline yields a final empty line).
  const totalLines = (chunk.totalLines ?? 0) + 1;

  if (offset - 1 >= totalLines) {
    throw new Error(`Offset ${offset} is beyond the end of ${remotePath} (${totalLines} lines).`);
  }

  const utf8PrefixBytes = completeUtf8PrefixLength(chunk.content);
  const displayBuffer = utf8PrefixBytes >= 0
    ? chunk.content.subarray(0, utf8PrefixBytes)
    : chunk.content;
  const windowText = displayBuffer.toString("utf8");
  const windowLines = windowText.split(/\r?\n/);
  // sed terminates every printed line, so a window ending in "\n" splits into
  // one extra empty element that is not a real file line.
  if (windowText.endsWith("\n")) {
    windowLines.pop();
  }

  // When the byte cap cut the window short, the final line may be incomplete.
  // Drop it so the next window re-reads it in full — unless it is the only
  // line, in which case showing the partial line beats showing nothing.
  let droppedPartialLine = false;
  if (chunk.reachedMaxBytes && !windowText.endsWith("\n") && windowLines.length > 1) {
    windowLines.pop();
    droppedPartialLine = true;
  }

  // Preserve the historical trailing-empty-line artifact when the window
  // reaches the end of a newline-terminated file.
  const lastWindowLine = offset + windowLines.length - 1;
  if (
    windowText.endsWith("\n") &&
    lastWindowLine === totalLines - 1 &&
    offset + limit - 1 >= totalLines
  ) {
    windowLines.push("");
  }

  const partialLineKept =
    chunk.reachedMaxBytes && !windowText.endsWith("\n") && !droppedPartialLine;
  const lineEnd = offset + windowLines.length - 1;
  const truncated = lineEnd < totalLines || droppedPartialLine || partialLineKept;
  const continuation = partialLineKept
    ? `\n\n[The final line is incomplete. Use offset=${lineEnd} byteOffset=${byteOffset + displayBuffer.length} to continue that line.]`
    : truncated
      ? `\n\n[Use offset=${lineEnd + 1} to continue.]`
      : "";
  const byteCapNote = droppedPartialLine
    ? `\n[Stopped at the ${formatSize(MAX_READ_WINDOW_BYTES)} per-read byte cap; the partial final line was omitted and will be re-read by the continuation offset.]`
    : partialLineKept
      ? `\n[Stopped at the ${formatSize(MAX_READ_WINDOW_BYTES)} per-read byte cap; the returned final line is only a byte fragment.]`
      : "";

  return {
    content:
      `File: ${remotePath}\n` +
      `Showing lines ${offset}-${lineEnd} of ${totalLines}${byteOffset > 0 ? ` (line ${offset} starting at byte ${byteOffset})` : ""}\n\n` +
      `${formatNumberedLines(windowLines, offset)}${continuation}${byteCapNote}`,
    details: {
      path: remotePath,
      bytes: chunk.totalBytes,
      lineOffset: offset,
      linesReturned: windowLines.length,
      totalLines,
      truncated,
      isBinary: false,
      byteLimited: chunk.reachedMaxBytes,
      lineByteOffset: byteOffset,
    },
  };
}

export function createSandboxReadTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "read",
    description:
      "Read a UTF-8 text file from the selected sandbox with 1-based line pagination. Returns up to 2,000 lines / 64 KiB and an exact offset (plus byteOffset for a single oversized line) when more remains. Use before editing or explaining code. Paths are canonicalized inside the workspace jail; binary files are reported instead of displayed. Read-only and safe to retry.",
    inputSchema: readInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaRead(input, sandboxOptions),
  });
}

export const createDaytonaReadTool = createSandboxReadTool;
