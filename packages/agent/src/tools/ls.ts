import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { resolveJailedSandboxPath } from "../sandbox/execute";
import { clampLimit, formatSize, MAX_FILE_OUTPUT_CHARS, toTextModelOutput } from "./format";
import { raceWithTimeout } from "./timeout";

const DEFAULT_LS_LIMIT = 200;
const MAX_LS_LIMIT = 1000;
const LS_TIMEOUT_MS = 30_000;

const lsInputSchema = z.object({
  path: z.string().max(4_096).optional().describe("Directory to list. Relative paths resolve from the sandbox workdir."),
  offset: z.number().int().min(1).optional().describe("1-based entry offset for continuing a large listing."),
  limit: z.number().int().min(1).max(MAX_LS_LIMIT).optional().describe("Maximum number of entries to show."),
});

type LsInput = z.infer<typeof lsInputSchema>;

interface FileListEntry {
  name: string;
  isDir?: boolean;
  size?: number;
  permissions?: string;
}

function formatEntry(entry: FileListEntry): string {
  const suffix = entry.isDir ? "/" : "";
  const size = entry.isDir ? "-" : formatSize(entry.size ?? 0);
  const permissions = entry.permissions ?? "---------";
  return `${permissions}  ${size.padStart(8)}  ${entry.name}${suffix}`;
}

async function executeDaytonaLs(input: LsInput, sandboxOptions: SandboxSessionOptions) {
  const context = await getSandboxContext(sandboxOptions);
  const remotePath = await resolveJailedSandboxPath(input.path, {
    workDir: context.workDir,
    sandboxOptions,
  });
  const limit = clampLimit(input.limit, DEFAULT_LS_LIMIT, MAX_LS_LIMIT);
  const offset = input.offset ?? 1;
  const allEntries = (await raceWithTimeout(
    () => context.sandbox.fs.listFiles(remotePath),
    LS_TIMEOUT_MS,
    () => new Error(`Timed out listing ${remotePath} in Daytona.`),
  ))
    .map((entry) => entry as FileListEntry)
    .sort((left, right) => left.name.localeCompare(right.name));

  if (allEntries.length === 0) {
    return {
      content: `Directory: ${remotePath}\n\n(empty directory)`,
      details: {
        path: remotePath,
        entries: 0,
        totalEntries: 0,
        offset,
        hasMore: false,
        truncated: false,
      },
    };
  }

  if (offset > allEntries.length) {
    throw new Error(`Offset ${offset} is beyond the end of ${remotePath} (${allEntries.length} entries).`);
  }

  const page = allEntries.slice(offset - 1, offset - 1 + limit);
  const lines: string[] = [];
  let bodyChars = 0;
  for (const entry of page) {
    const line = formatEntry(entry);
    const nextChars = bodyChars + (lines.length > 0 ? 1 : 0) + line.length;
    if (nextChars > MAX_FILE_OUTPUT_CHARS && lines.length > 0) break;
    lines.push(line.slice(0, MAX_FILE_OUTPUT_CHARS));
    bodyChars = Math.min(nextChars, MAX_FILE_OUTPUT_CHARS);
  }
  const shown = lines.length;
  const nextOffset = offset + shown;
  const hasMore = nextOffset <= allEntries.length;
  const continuation = hasMore ? `\n\n[Use offset=${nextOffset} to continue.]` : "";

  return {
    content:
      `Directory: ${remotePath}\n` +
      `Showing entries ${offset}-${offset + shown - 1} of ${allEntries.length}\n\n` +
      `${lines.join("\n")}${continuation}`,
    details: {
      path: remotePath,
      entries: shown,
      totalEntries: allEntries.length,
      offset,
      hasMore,
      nextOffset: hasMore ? nextOffset : null,
      truncated: hasMore,
    },
  };
}

export function createDaytonaLsTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "ls",
    description:
      "List one Daytona sandbox directory in stable name order with 1-based offset pagination. Use for quick directory inspection before broader searches or reads, and follow nextOffset when more entries remain. Paths are canonicalized inside the workspace jail. Read-only and safe to retry.",
    inputSchema: lsInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaLs(input, sandboxOptions),
  });
}
