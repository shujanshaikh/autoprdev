import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { executeSandboxCommand, resolveSandboxPath, shellQuote } from "../sandbox/execute";
import { clampLimit, MAX_FILE_OUTPUT_CHARS, toTextModelOutput, truncateText } from "./format";

const DEFAULT_GREP_LIMIT = 100;
const MAX_GREP_LIMIT = 500;

const grepInputSchema = z.object({
  pattern: z.string().describe("Search pattern to look for. Treated as regex unless literal=true."),
  path: z.string().optional().describe("File or directory to search. Relative paths resolve from the sandbox workdir."),
  glob: z.string().optional().describe("Optional glob filter for files, such as '*.ts'."),
  ignoreCase: z.boolean().optional().describe("Whether the search should ignore case."),
  literal: z.boolean().optional().describe("Whether to treat the pattern as a literal string instead of a regex."),
  context: z.number().min(0).optional().describe("Number of context lines to include around each match."),
  limit: z.number().min(1).optional().describe("Maximum number of matches to return."),
});

type GrepInput = z.infer<typeof grepInputSchema>;

function buildGrepCommand(input: GrepInput, remotePath: string): string {
  const limit = clampLimit(input.limit, DEFAULT_GREP_LIMIT, MAX_GREP_LIMIT);
  const context = Math.max(0, input.context ?? 0);
  const rgArgs = [
    "rg",
    "--line-number",
    "--color=never",
    "--hidden",
    "--max-count",
    String(limit),
    "-g",
    "!.git",
    "-g",
    "!node_modules",
  ];

  if (input.ignoreCase) {
    rgArgs.push("--ignore-case");
  }

  if (input.literal) {
    rgArgs.push("--fixed-strings");
  }

  if (context > 0) {
    rgArgs.push("-C", String(context));
  }

  if (input.glob) {
    rgArgs.push("--glob", input.glob);
  }

  rgArgs.push(input.pattern, remotePath);

  const grepArgs = ["grep", "-R", "-n"];
  if (input.ignoreCase) {
    grepArgs.push("-i");
  }

  if (context > 0) {
    grepArgs.push("-C", String(context));
  }

  grepArgs.push("--exclude-dir=.git", "--exclude-dir=node_modules");

  if (input.glob) {
    grepArgs.push(`--include=${input.glob}`);
  }

  grepArgs.push(input.literal ? "-F" : "-E", input.pattern, remotePath);

  const rgCommand = rgArgs.map(shellQuote).join(" ");
  const grepCommand = `${grepArgs.map(shellQuote).join(" ")} | head -n ${shellQuote(String(limit))}`;

  return `if command -v rg >/dev/null 2>&1; then ${rgCommand}; else ${grepCommand}; fi`;
}

async function executeDaytonaGrep(input: GrepInput, sandboxOptions: SandboxSessionOptions) {
  "use step";

  const context = await getSandboxContext(sandboxOptions);
  const remotePath = resolveSandboxPath(input.path, context.workDir);
  const result = await executeSandboxCommand(buildGrepCommand(input, remotePath), {
    cwd: context.workDir,
    sandboxOptions,
  });

  const output = (result.stdout ?? "").trim() || (result.stderr ?? "").trim();
  const body = truncateText(output || "No matches found.", MAX_FILE_OUTPUT_CHARS);

  return {
    content:
      `Search root: ${remotePath}\n` +
      `Pattern: ${input.pattern}\n` +
      `Exit code: ${result.exitCode ?? "unknown"}\n\n` +
      body.text,
    details: {
      path: remotePath,
      pattern: input.pattern,
      exitCode: result.exitCode ?? null,
      truncated: body.truncated,
    },
  };
}

export function createDaytonaGrepTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "grep",
    description: "Search file contents in the Daytona sandbox.",
    inputSchema: grepInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaGrep(input, sandboxOptions),
  });
}
