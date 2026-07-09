import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { resolveSandboxPath } from "../sandbox/execute";
import { clampLimit, formatNumberedLines, isProbablyBinary, toTextModelOutput } from "./format";
import { requireString } from "./validation";

const DEFAULT_READ_LIMIT = 200;
const MAX_READ_LIMIT = 400;

const readInputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe("Required. Path to the file to read. Relative paths resolve from the sandbox workdir."),
  offset: z.number().min(1).optional().describe("Line number to start reading from. Uses 1-based indexing."),
  limit: z.number().min(1).optional().describe("Maximum number of lines to return."),
});

type ReadInput = z.infer<typeof readInputSchema>;

async function executeDaytonaRead(input: ReadInput, sandboxOptions: SandboxSessionOptions) {
  const path = requireString(input.path, "path", "read");
  const context = await getSandboxContext(sandboxOptions);
  const remotePath = resolveSandboxPath(path, context.workDir);
  const fileBuffer = Buffer.from(await context.sandbox.fs.downloadFile(remotePath));

  if (isProbablyBinary(fileBuffer)) {
    return {
      content: `Cannot display ${remotePath} as text because it appears to be binary.`,
      details: {
        path: remotePath,
        bytes: fileBuffer.length,
        lineOffset: input.offset ?? 1,
        linesReturned: 0,
        totalLines: 0,
        truncated: false,
        isBinary: true,
      },
    };
  }

  const offset = Math.max(1, input.offset ?? 1);
  const limit = clampLimit(input.limit, DEFAULT_READ_LIMIT, MAX_READ_LIMIT);
  const lines = fileBuffer.toString("utf8").split(/\r?\n/);
  const startIndex = offset - 1;

  if (startIndex >= lines.length) {
    throw new Error(`Offset ${offset} is beyond the end of ${remotePath} (${lines.length} lines).`);
  }

  const selectedLines = lines.slice(startIndex, startIndex + limit);
  const lineEnd = startIndex + selectedLines.length;
  const truncated = lineEnd < lines.length;
  const continuation = truncated ? `\n\n[Use offset=${lineEnd + 1} to continue.]` : "";

  return {
    content:
      `File: ${remotePath}\n` +
      `Showing lines ${offset}-${lineEnd} of ${lines.length}\n\n` +
      `${formatNumberedLines(selectedLines, offset)}${continuation}`,
    details: {
      path: remotePath,
      bytes: fileBuffer.length,
      lineOffset: offset,
      linesReturned: selectedLines.length,
      totalLines: lines.length,
      truncated,
      isBinary: false,
    },
  };
}

export function createDaytonaReadTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "read",
    description:
      "Read a UTF-8 text file from the Daytona sandbox with optional line offset and limit. Use before editing or explaining code. Relative paths resolve from the sandbox workdir. Read-only and safe to retry; binary files are reported instead of displayed.",
    inputSchema: readInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaRead(input, sandboxOptions),
  });
}
