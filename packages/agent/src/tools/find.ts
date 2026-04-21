import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { resolveSandboxPath } from "../sandbox/execute";
import { clampLimit, MAX_FILE_OUTPUT_CHARS, toTextModelOutput, truncateText } from "./format";

const DEFAULT_FIND_LIMIT = 200;
const MAX_FIND_LIMIT = 1000;

const findInputSchema = z.object({
  pattern: z.string().describe("Glob pattern to search for, such as '*.ts' or '**/*.json'."),
  path: z.string().optional().describe("Directory to search inside. Relative paths resolve from the sandbox workdir."),
  limit: z.number().min(1).optional().describe("Maximum number of matches to return."),
});

type FindInput = z.infer<typeof findInputSchema>;

function posixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function relativeUnderRoot(root: string, file: string): string {
  const cleanRoot = root.replace(/\/+$/, "") || "/";
  const cleanFile = posixPath(file);

  if (cleanFile === cleanRoot) {
    return "";
  }

  const prefix = cleanRoot === "/" ? "/" : `${cleanRoot}/`;
  return cleanFile.startsWith(prefix) ? cleanFile.slice(prefix.length) : cleanFile;
}

async function executeDaytonaFind(input: FindInput, sandboxOptions: SandboxSessionOptions) {
  "use step";

  const context = await getSandboxContext(sandboxOptions);
  const remotePath = resolveSandboxPath(input.path, context.workDir);
  const limit = clampLimit(input.limit, DEFAULT_FIND_LIMIT, MAX_FIND_LIMIT);
  const result = await context.sandbox.fs.searchFiles(remotePath, input.pattern);
  const relativeMatches = [...result.files]
    .map((entry) => relativeUnderRoot(remotePath, entry))
    .filter((entry) => entry.length > 0)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, limit);

  if (relativeMatches.length === 0) {
    return {
      content: `No files matched ${input.pattern} in ${remotePath}.`,
      details: {
        path: remotePath,
        pattern: input.pattern,
        matches: 0,
        truncated: false,
      },
    };
  }

  const body = truncateText(relativeMatches.join("\n"), MAX_FILE_OUTPUT_CHARS);

  return {
    content:
      `Search root: ${remotePath}\n` +
      `Pattern: ${input.pattern}\n` +
      `Matches shown: ${relativeMatches.length}\n\n` +
      body.text,
    details: {
      path: remotePath,
      pattern: input.pattern,
      matches: relativeMatches.length,
      truncated: body.truncated,
    },
  };
}

export function createDaytonaFindTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "find",
    description: "Find files in the sandbox by glob pattern.",
    inputSchema: findInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaFind(input, sandboxOptions),
  });
}
