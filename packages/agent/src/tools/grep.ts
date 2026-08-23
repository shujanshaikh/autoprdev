import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { resolveJailedSandboxPath } from "../sandbox/execute";
import { executeAutoprFff } from "./fff";
import { clampLimit, MAX_FILE_OUTPUT_CHARS, toTextModelOutput, truncateText } from "./format";
import { requireString } from "./validation";

const DEFAULT_GREP_LIMIT = 100;
const MAX_GREP_LIMIT = 500;
const FFF_GREP_TIME_BUDGET_MS = 10_000;
const MAX_LINE_CHARS = 800;
const searchFilterSchema = z.string().max(4_096);

const grepInputSchema = z.object({
  pattern: z.string().max(8_192).optional().describe("Required concrete substring, identifier, or regex. Auto-detects regex syntax; wildcard-only match-everything patterns are rejected."),
  path: z
    .string()
    .max(4_096)
    .optional()
    .describe("Optional file, directory, or glob constraint. Relative paths resolve from the sandbox workdir."),
  glob: searchFilterSchema.optional().describe("Optional glob filter for files, such as '*.ts'."),
  exclude: z
    .union([searchFilterSchema, z.array(searchFilterSchema).max(100)])
    .optional()
    .describe("Optional path exclusions, such as 'test/,*.min.js' or ['test/', '*.min.js']."),
  mode: z.enum(["auto", "plain", "regex", "fuzzy"]).optional().describe("FFF grep mode. auto uses regex only when the pattern contains valid regex syntax."),
  ignoreCase: z.boolean().optional().describe("Force case-insensitive matching."),
  caseSensitive: z.boolean().optional().describe("Force case-sensitive matching. By default FFF smart-case is used."),
  literal: z.boolean().optional().describe("Deprecated alias for mode='plain'."),
  context: z.number().int().min(0).max(10).optional().describe("Number of context lines to include around each match, up to 10."),
  limit: z.number().int().min(1).max(MAX_GREP_LIMIT).optional().describe("Maximum number of matches to return."),
  cursor: z.string().max(16_384).optional().describe("Opaque pagination cursor returned by a previous grep result."),
}).refine(
  (input) => !(input.ignoreCase && input.caseSensitive),
  { message: "ignoreCase and caseSensitive cannot both be true." },
);

type GrepInput = z.infer<typeof grepInputSchema>;

interface FffGrepMatch {
  relativePath: string;
  gitStatus?: string;
  lineNumber: number;
  lineContent: string;
  contextBefore?: string[];
  contextAfter?: string[];
  isDefinition?: boolean;
}

interface FffGrepResult {
  pattern?: string;
  query?: string;
  glob?: string;
  mode?: string;
  ignoreCase?: boolean;
  items?: FffGrepMatch[];
  totalMatched?: number;
  totalFiles?: number;
  totalFilesSearched?: number;
  filteredFileCount?: number;
  regexFallbackError?: string;
  nextCursor?: string | null;
  fallback?: {
    type?: "auto-broaden" | "fuzzy";
    from?: string;
    to?: string;
  };
}

export interface DaytonaGrepDependencies {
  getSandboxContext: (options: SandboxSessionOptions) => Promise<{ workDir: string }>;
  resolveJailedSandboxPath: typeof resolveJailedSandboxPath;
  executeFff: (
    subcommand: string,
    flags: Parameters<typeof executeAutoprFff>[1],
    options: SandboxSessionOptions,
  ) => Promise<Awaited<ReturnType<typeof executeAutoprFff<FffGrepResult>>>>;
}

const defaultDependencies: DaytonaGrepDependencies = {
  getSandboxContext,
  resolveJailedSandboxPath,
  executeFff: executeAutoprFff<FffGrepResult>,
};

async function executeDaytonaGrep(input: GrepInput, sandboxOptions: SandboxSessionOptions, dependencies: DaytonaGrepDependencies) {
  const pattern = requireString(input.pattern, "pattern", "grep");
  if (isWildcardOnlyPattern(pattern)) {
    throw new Error(
      `Pattern "${pattern}" matches everything. grep requires a concrete substring or identifier; use read for a known file or find for file discovery.`,
    );
  }
  const context = await dependencies.getSandboxContext(sandboxOptions);
  const remotePath = context.workDir;
  const scopePath = input.path
    ? await dependencies.resolveJailedSandboxPath(input.path, { workDir: context.workDir, sandboxOptions })
    : undefined;
  const limit = clampLimit(input.limit, DEFAULT_GREP_LIMIT, MAX_GREP_LIMIT);
  const contextLines = Math.max(0, input.context ?? 0);
  const mode = input.mode ?? (input.literal ? "plain" : "auto");
  const result = await dependencies.executeFff("grep", {
    cwd: remotePath,
    pattern,
    path: scopePath,
    glob: input.glob,
    exclude: formatExcludeFlag(input.exclude),
    mode,
    "ignore-case": input.ignoreCase,
    "case-sensitive": input.caseSensitive,
    context: contextLines,
    limit,
    cursor: input.cursor,
    "max-matches-per-file": Math.min(limit, 50),
    "time-budget-ms": FFF_GREP_TIME_BUDGET_MS,
  }, sandboxOptions);

  if (!result.ok) {
    throw new Error(`${result.error}\nExit code: ${result.exitCode ?? "unknown"}`);
  }

  const output = formatFffGrepOutput(result.value);
  const body = truncateText(output || "No matches found.", MAX_FILE_OUTPUT_CHARS);
  const notices = formatGrepNotices(result.value, body.truncated);
  const cursorWithheld = body.truncated && Boolean(result.value.nextCursor);

  return {
    content:
      `Search engine: fff\n` +
      `Search root: ${remotePath}\n` +
      (scopePath ? `Scope: ${scopePath}\n` : "") +
      `Pattern: ${pattern}\n` +
      `Mode: ${result.value.mode ?? mode}${input.glob ? `\nGlob: ${input.glob}` : ""}\n` +
      `Matches shown: ${result.value.items?.length ?? 0}\n\n` +
      body.text +
      notices,
    details: {
      engine: "fff",
      path: remotePath,
      scope: scopePath,
      pattern,
      query: result.value.query,
      glob: input.glob,
      mode: result.value.mode ?? mode,
      matches: result.value.items?.length ?? 0,
      totalMatched: result.value.totalMatched ?? result.value.items?.length ?? 0,
      totalFiles: result.value.totalFiles,
      totalFilesSearched: result.value.totalFilesSearched,
      filteredFileCount: result.value.filteredFileCount,
      hasMore: body.truncated || Boolean(result.value.nextCursor),
      nextCursor: cursorWithheld ? null : result.value.nextCursor,
      fallback: result.value.fallback,
      regexFallbackError: result.value.regexFallbackError,
      exitCode: result.exitCode,
      truncated: body.truncated,
    },
  };
}

function isWildcardOnlyPattern(pattern: string): boolean {
  const trimmed = pattern.trim();
  const hasRegexSyntax = /[.*+?^${}()|[\]\\]/.test(trimmed);
  if (!trimmed || !hasRegexSyntax) {
    return false;
  }

  return /^(?:[.^$]*(?:[.][*+?]|\*|\+)[.^$]*|[.^$\s]*|\.\*\??|\.\*[+?]?|\.\+\??|\.|\*|\?)$/.test(
    trimmed,
  );
}

function formatFffGrepOutput(result: FffGrepResult): string {
  const matches = result.items ?? [];
  if (matches.length === 0) {
    return "No matches found.";
  }

  const lines: string[] = [];
  let currentFile = "";

  for (const match of matches) {
    if (match.relativePath !== currentFile) {
      if (lines.length > 0) {
        lines.push("");
      }

      currentFile = match.relativePath;
      lines.push(`${currentFile}${formatGitStatus(match.gitStatus)}`);
    }

    for (const [index, line] of (match.contextBefore ?? []).entries()) {
      const lineNumber = match.lineNumber - (match.contextBefore?.length ?? 0) + index;
      lines.push(`${lineNumber}- ${truncateLine(line)}`);
    }

    lines.push(`${match.lineNumber}: ${truncateLine(match.lineContent)}${match.isDefinition ? " [definition]" : ""}`);

    for (const [index, line] of (match.contextAfter ?? []).entries()) {
      lines.push(`${match.lineNumber + index + 1}- ${truncateLine(line)}`);
    }
  }

  return lines.join("\n");
}

function formatGitStatus(status: string | undefined): string {
  if (!status || status === "clean" || status === "unknown") {
    return "";
  }

  return ` [${status}]`;
}

function truncateLine(line: string): string {
  if (line.length <= MAX_LINE_CHARS) {
    return line;
  }

  return `${line.slice(0, MAX_LINE_CHARS)} ...`;
}

function formatGrepNotices(result: FffGrepResult, outputTruncated: boolean): string {
  const notices: string[] = [];

  if (result.regexFallbackError) {
    notices.push(`Invalid regex: ${result.regexFallbackError}; fff used literal matching.`);
  }

  if (result.fallback?.type === "auto-broaden" && result.fallback.from && result.fallback.to) {
    notices.push(`0 matches for "${result.fallback.from}"; fff broadened to "${result.fallback.to}".`);
  }

  if (result.fallback?.type === "fuzzy" && result.fallback.from && result.fallback.to) {
    notices.push(`0 exact matches for "${result.fallback.from}"; fff returned fuzzy matches for "${result.fallback.to}".`);
  }

  if (outputTruncated) {
    notices.push("Output was truncated before every fetched match was visible. Refine pattern/path; the cursor was withheld to avoid skipping unseen matches.");
  } else if (result.nextCursor) {
    notices.push(`More matches are available. Continue with cursor="${result.nextCursor}".`);
  }

  if (notices.length === 0) {
    return "";
  }

  return `\n\n[${notices.join(" ")}]`;
}

function formatExcludeFlag(exclude: GrepInput["exclude"]): string | undefined {
  if (!exclude) {
    return undefined;
  }

  if (Array.isArray(exclude)) {
    return exclude.join(",");
  }

  return exclude;
}

export function createDaytonaGrepTool(
  sandboxOptions: SandboxSessionOptions,
  dependencies: DaytonaGrepDependencies = defaultDependencies,
) {
  return tool({
    title: "grep",
    description:
      "Search workspace file contents using FFF indexed grep with bounded line/context output. Use a concrete substring, identifier, or intentional regex to locate behavior before editing; use read instead of wildcard-only patterns to inspect a known file. Scoped paths are canonicalized through the workspace jail. Continue with nextCursor when returned; refine the query when output truncation withholds it. Read-only and safe to retry.",
    inputSchema: grepInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaGrep(input, sandboxOptions, dependencies),
  });
}
