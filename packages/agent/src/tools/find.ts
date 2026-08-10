import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { resolveJailedSandboxPath } from "../sandbox/execute";
import { executeAutoprFff } from "./fff";
import { clampLimit, MAX_FILE_OUTPUT_CHARS, toTextModelOutput, truncateText } from "./format";
import { requireString } from "./validation";

const DEFAULT_FIND_LIMIT = 200;
const MAX_FIND_LIMIT = 1000;
const searchFilterSchema = z.string().max(4_096);

const findInputSchema = z.object({
  pattern: z
    .string()
    .max(4_096)
    .optional()
    .describe("Required unless cursor is provided. Fuzzy file query or glob/path constraint, such as 'thread chat', '*.ts', or '**/*.json'."),
  path: z
    .string()
    .max(4_096)
    .optional()
    .describe("Optional file, directory, or glob constraint. Relative paths resolve from the sandbox workdir."),
  exclude: z
    .union([searchFilterSchema, z.array(searchFilterSchema).max(100)])
    .optional()
    .describe("Optional path exclusions, such as 'test/,*.min.js' or ['test/', '*.min.js']."),
  mode: z
    .enum(["auto", "fuzzy", "glob", "directory", "directories", "mixed"])
    .optional()
    .describe("fff search mode. auto uses FFF fuzzy path search with native glob/path constraints."),
  limit: z.number().int().min(1).max(MAX_FIND_LIMIT).optional().describe("Maximum number of matches to return."),
  cursor: z.string().max(16_384).optional().describe("Opaque pagination cursor returned by a previous find result."),
});

type FindInput = z.infer<typeof findInputSchema>;

interface FffFindItem {
  relativePath?: string;
  fileName?: string;
  dirName?: string;
  gitStatus?: string;
  totalFrecencyScore?: number;
  accessFrecencyScore?: number;
  type?: "file" | "directory";
  item?: FffFindItem;
}

interface FffFindScore {
  total?: number;
  exactMatch?: boolean;
}

interface FffFindResult {
  mode?: string;
  query?: string;
  pattern?: string;
  items?: FffFindItem[];
  scores?: FffFindScore[];
  totalMatched?: number;
  totalFiles?: number;
  totalDirs?: number;
  pageIndex?: number;
  nextCursor?: string | null;
  autoBroadenedFrom?: string;
  weak?: boolean;
}

async function executeDaytonaFind(input: FindInput, sandboxOptions: SandboxSessionOptions) {
  const cursor = input.cursor?.trim();
  const pattern = cursor ? (input.pattern?.trim() ?? "") : requireString(input.pattern, "pattern", "find");
  const context = await getSandboxContext(sandboxOptions);
  const remotePath = context.workDir;
  const scopePath = input.path
    ? await resolveJailedSandboxPath(input.path, { workDir: context.workDir, sandboxOptions })
    : undefined;
  const limit = clampLimit(input.limit, DEFAULT_FIND_LIMIT, MAX_FIND_LIMIT);
  const result = await executeAutoprFff<FffFindResult>(
    "find",
    {
      cwd: remotePath,
      query: pattern || undefined,
      path: scopePath,
      exclude: formatExcludeFlag(input.exclude),
      mode: input.mode ?? "auto",
      limit,
      cursor,
    },
    sandboxOptions,
  );

  if (!result.ok) {
    throw new Error(`${result.error}\nExit code: ${result.exitCode ?? "unknown"}`);
  }

  const effectivePattern = result.value.pattern ?? pattern;
  const relativeMatches = (result.value.items ?? []).map(formatFffFindItem).filter(isNonEmptyString).slice(0, limit);

  if (relativeMatches.length === 0) {
    return {
      content:
        `Search engine: fff\n` +
        `Search root: ${remotePath}\n` +
        (scopePath ? `Scope: ${scopePath}\n` : "") +
        `Pattern: ${effectivePattern}\n\n` +
        `No files matched using fff.`,
      details: {
        engine: "fff",
        path: remotePath,
        scope: scopePath,
        pattern: effectivePattern,
        mode: result.value.mode ?? input.mode ?? "auto",
        matches: 0,
        totalMatched: result.value.totalMatched ?? 0,
        exitCode: result.exitCode,
        truncated: false,
      },
    };
  }

  const output = formatFffFindOutput(relativeMatches, result.value, effectivePattern);
  const body = truncateText(output, MAX_FILE_OUTPUT_CHARS);
  const cursorWithheld = body.truncated && Boolean(result.value.nextCursor);
  const continuation = cursorWithheld
    ? "\n\n[Output was truncated before every fetched match was visible. Refine pattern/path; the cursor was withheld to avoid skipping unseen matches.]"
    : "";

  return {
    content:
      `Search engine: fff\n` +
      `Search root: ${remotePath}\n` +
      (scopePath ? `Scope: ${scopePath}\n` : "") +
      `Pattern: ${effectivePattern}\n` +
      `Mode: ${result.value.mode ?? input.mode ?? "auto"}\n` +
      `Matches shown: ${relativeMatches.length}\n\n` +
      body.text + continuation,
    details: {
      engine: "fff",
      path: remotePath,
      scope: scopePath,
      pattern: effectivePattern,
      query: result.value.query,
      mode: result.value.mode ?? input.mode ?? "auto",
      matches: relativeMatches.length,
      totalMatched: result.value.totalMatched ?? relativeMatches.length,
      totalFiles: result.value.totalFiles,
      totalDirs: result.value.totalDirs,
      pageIndex: result.value.pageIndex,
      hasMore: body.truncated || Boolean(result.value.nextCursor),
      nextCursor: cursorWithheld ? null : result.value.nextCursor,
      weak: result.value.weak,
      exitCode: result.exitCode,
      truncated: body.truncated,
    },
  };
}

function formatFffFindItem(entry: FffFindItem): string {
  const item = entry.item ?? entry;
  const relativePath = item.relativePath ?? "";
  const suffix = formatFileAnnotation(item);
  return `${relativePath}${suffix}`;
}

function formatFffFindOutput(matches: string[], result: FffFindResult, pattern: string): string {
  const lines: string[] = [];
  const firstPath = (result.items?.[0]?.item ?? result.items?.[0])?.relativePath;
  const firstScore = result.scores?.[0];
  const secondScore = result.scores?.[1];

  if (firstPath && (result.pageIndex ?? 0) === 0) {
    if (firstScore?.exactMatch) {
      lines.push(`Read first: ${firstPath} (exact match)`);
    } else if (firstScore?.total !== undefined && (secondScore?.total === undefined || firstScore.total > secondScore.total * 2)) {
      lines.push(`Read first: ${firstPath} (best match)`);
    }
  }

  lines.push(...matches);

  const notices: string[] = [];
  if (result.autoBroadenedFrom) {
    notices.push(`0 matches for "${result.autoBroadenedFrom}"; fff broadened to "${pattern}".`);
  }
  if (result.weak) {
    notices.push(`Weak scattered fuzzy matches for "${pattern}"; refine the query if these are not useful.`);
  }
  if (result.nextCursor) {
    notices.push(`More matches are available. Continue with cursor="${result.nextCursor}".`);
  }

  if (notices.length > 0) {
    lines.push("", `[${notices.join(" ")}]`);
  }

  return lines.join("\n");
}

function formatFileAnnotation(item: FffFindItem): string {
  const status = item.gitStatus;
  if (status && status !== "clean" && status !== "unknown") {
    return ` [${status}]`;
  }

  const frecency = item.totalFrecencyScore ?? item.accessFrecencyScore ?? 0;
  if (frecency >= 100) {
    return " [hot]";
  }
  if (frecency >= 50) {
    return " [warm]";
  }

  return "";
}

function formatExcludeFlag(exclude: FindInput["exclude"]): string | undefined {
  if (!exclude) {
    return undefined;
  }

  if (Array.isArray(exclude)) {
    return exclude.join(",");
  }

  return exclude;
}

function isNonEmptyString(value: string): value is string {
  return value.trim().length > 0;
}

export function createDaytonaFindTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "find",
    description:
      "Find files in the Daytona workspace using FFF fuzzy search or glob filtering. Use for filename discovery, locating config/docs/tests, or narrowing a work area before reading. Scoped paths are canonicalized through the workspace jail. Continue with nextCursor when returned; refine the query when output truncation withholds it. Read-only and safe to retry.",
    inputSchema: findInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaFind(input, sandboxOptions),
  });
}
