import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { resolveSandboxPath } from "../sandbox/execute";
import { clampLimit, formatSize, MAX_FILE_OUTPUT_CHARS, toTextModelOutput, truncateText } from "./format";

const DEFAULT_LS_LIMIT = 200;
const MAX_LS_LIMIT = 1000;

const lsInputSchema = z.object({
  path: z.string().optional().describe("Directory to list. Relative paths resolve from the sandbox workdir."),
  limit: z.number().min(1).optional().describe("Maximum number of entries to show."),
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
  "use step";

  const context = await getSandboxContext(sandboxOptions);
  const remotePath = resolveSandboxPath(input.path, context.workDir);
  const limit = clampLimit(input.limit, DEFAULT_LS_LIMIT, MAX_LS_LIMIT);
  const entries = (await context.sandbox.fs.listFiles(remotePath))
    .map((entry) => entry as FileListEntry)
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, limit);

  if (entries.length === 0) {
    return {
      content: `Directory: ${remotePath}\n\n(empty directory)`,
      details: {
        path: remotePath,
        entries: 0,
        truncated: false,
      },
    };
  }

  const body = truncateText(entries.map(formatEntry).join("\n"), MAX_FILE_OUTPUT_CHARS);

  return {
    content: `Directory: ${remotePath}\nEntries shown: ${entries.length}\n\n${body.text}`,
    details: {
      path: remotePath,
      entries: entries.length,
      truncated: body.truncated,
    },
  };
}

export function createDaytonaLsTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "ls",
    description: "List files and directories in the Daytona sandbox.",
    inputSchema: lsInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaLs(input, sandboxOptions),
  });
}
