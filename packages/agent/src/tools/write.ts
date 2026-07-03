import { tool } from "ai";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";

import { getSandboxContext, type DaytonaSandbox, type SandboxSessionOptions } from "../sandbox";
import {
  ensureRemoteParentDirectory,
  executeSandboxCommand,
  resolveSandboxPath,
  shellQuote,
} from "../sandbox/execute";
import { createFileMutationQueueKey, withFileMutationQueue } from "./file-mutation-queue";
import { formatSize, toTextModelOutput } from "./format";
import { raceWithTimeout } from "./timeout";
import { requireString } from "./validation";

const MAX_WRITE_CONTENT_CHARS = 20_000;

// Total time budget for one write call. Kept well below Vercel's 5-minute step
// limit so a slow sandbox operation fails fast with an actionable, retryable
// error instead of the platform killing the step, which leaves the UI stuck
// and silently discards the write.
const WRITE_DEADLINE_MS = 4 * 60 * 1000;

// Existing files larger than this are never downloaded for diffing. Writes to
// them use remote-side operations so cost stays proportional to the chunk
// being written instead of the full file size.
const MAX_DIFF_SOURCE_BYTES = 256 * 1024;

const STAT_COMMAND_TIMEOUT_SECONDS = 30;
const APPEND_COMMAND_TIMEOUT_SECONDS = 60;

// Bounded read used to reconstruct the trailing (unterminated) line of a large
// file so append diffs stay semantically exact without downloading the file.
const MAX_TRAILING_LINE_READ_BYTES = 4096;

const writeInputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe("Required. Path to the file to write. Relative paths resolve from the sandbox workdir."),
  content: z
    .string()
    .max(MAX_WRITE_CONTENT_CHARS)
    .optional()
    .describe(
      `Required. File content for this write call. Maximum ${MAX_WRITE_CONTENT_CHARS} characters. For larger files, make multiple sequential write calls with mode=append.`,
    ),
  mode: z
    .enum(["overwrite", "append"])
    .optional()
    .describe("Write mode. Defaults to overwrite. Use append for subsequent chunks of a large file."),
});

type WriteInput = z.infer<typeof writeInputSchema>;

type WriteMode = "overwrite" | "append";

interface WriteDiff {
  renderer: "pierre";
  fileName: string;
  patch: string;
  status: "added" | "modified";
  /** True when the patch shows only the changed chunk, not the whole file. */
  truncated?: boolean;
}

type DaytonaFileSystemError = {
  errorCode?: unknown;
  statusCode?: unknown;
};

function getDaytonaFileSystemError(error: unknown): DaytonaFileSystemError | null {
  return error && typeof error === "object" ? (error as DaytonaFileSystemError) : null;
}

function isMissingRemoteFileError(error: unknown): boolean {
  const fileError = getDaytonaFileSystemError(error);
  return fileError?.statusCode === 404 || fileError?.errorCode === "FILE_NOT_FOUND";
}

async function readRemoteTextIfPresent(sandbox: DaytonaSandbox, remotePath: string): Promise<string | null> {
  try {
    const previousBuffer = Buffer.from(await sandbox.fs.downloadFile(remotePath));
    return previousBuffer.toString("utf8");
  } catch (error) {
    if (isMissingRemoteFileError(error)) {
      return null;
    }

    throw error;
  }
}

interface WriteDeadline {
  remainingMs(): number;
  run<T>(phase: string, task: () => Promise<T>): Promise<T>;
}

function createWriteTimeoutError(phase: string): Error {
  return new Error(
    `write timed out while ${phase} (budget: ${Math.round(WRITE_DEADLINE_MS / 1000)}s, kept below the platform step limit). ` +
      "The target file may be partially written. Retry the write; for large files keep sending sequential mode=append chunks.",
  );
}

function createWriteDeadline(totalMs: number): WriteDeadline {
  const startedAt = Date.now();
  const remainingMs = () => Math.max(0, totalMs - (Date.now() - startedAt));

  return {
    remainingMs,
    run: (phase, task) => raceWithTimeout(task, remainingMs(), () => createWriteTimeoutError(phase)),
  };
}

interface RemoteFileStat {
  exists: boolean;
  bytes: number;
  newlineCount: number;
  endsWithNewline: boolean;
}

/**
 * Inspect the remote file with one cheap shell command instead of downloading
 * it, so writes to large files never pay a full-content round trip up front.
 */
async function statRemoteFile(remotePath: string, sandboxOptions: SandboxSessionOptions): Promise<RemoteFileStat> {
  const quoted = shellQuote(remotePath);
  const result = await executeSandboxCommand(
    `if [ -e ${quoted} ]; then printf 'exists %s %s %s\\n' "$(wc -c < ${quoted})" "$(wc -l < ${quoted})" "$(tail -c 1 ${quoted} | wc -l)"; else printf 'missing\\n'; fi`,
    { cwd: "/", timeout: STAT_COMMAND_TIMEOUT_SECONDS, sandboxOptions },
  );
  const output = (result.stdout ?? result.output ?? "").trim();

  if (result.timedOut || result.exitCode !== 0) {
    throw new Error(`write could not inspect ${remotePath}: ${result.stderr?.trim() || output || "unknown error"}`);
  }

  const match = /exists\s+(\d+)\s+(\d+)\s+(\d+)/.exec(output);
  if (match) {
    return {
      exists: true,
      bytes: Number(match[1]),
      newlineCount: Number(match[2]),
      endsWithNewline: match[3] === "1",
    };
  }

  if (output.includes("missing")) {
    return { exists: false, bytes: 0, newlineCount: 0, endsWithNewline: false };
  }

  throw new Error(`write could not parse file metadata for ${remotePath}.`);
}

/**
 * Append a chunk on the remote side via base64 so large files are never
 * downloaded and re-uploaded in full for every append call.
 */
async function appendRemoteChunk(
  remotePath: string,
  chunk: Buffer,
  sandboxOptions: SandboxSessionOptions,
): Promise<void> {
  const result = await executeSandboxCommand(
    `printf %s ${shellQuote(chunk.toString("base64"))} | base64 -d >> ${shellQuote(remotePath)}`,
    { cwd: "/", timeout: APPEND_COMMAND_TIMEOUT_SECONDS, sandboxOptions },
  );

  if (result.timedOut || result.exitCode !== 0) {
    throw new Error(
      `write failed to append to ${remotePath}: ${result.stderr?.trim() || result.output?.trim() || "unknown error"}`,
    );
  }
}

/**
 * Read the trailing unterminated line of a remote file with a bounded `tail`
 * so append diffs can be exact when the file does not end with a newline.
 * Returns null when the trailing line exceeds the bounded read (or the read
 * fails); callers then fall back to an insertion-only patch.
 */
async function readRemoteTrailingLine(
  remotePath: string,
  sandboxOptions: SandboxSessionOptions,
): Promise<string | null> {
  const result = await executeSandboxCommand(
    `tail -c ${MAX_TRAILING_LINE_READ_BYTES} ${shellQuote(remotePath)} | base64 -w 0`,
    { cwd: "/", timeout: STAT_COMMAND_TIMEOUT_SECONDS, sandboxOptions },
  );

  if (result.timedOut || result.exitCode !== 0) {
    return null;
  }

  const encoded = (result.stdout ?? result.output ?? "").trim();
  if (!encoded) {
    return null;
  }

  const text = Buffer.from(encoded, "base64").toString("utf8");
  const newlineIndex = text.lastIndexOf("\n");

  // No newline within the bounded window means the trailing line is longer
  // than the window (large files always exceed it), so we cannot reconstruct
  // it exactly.
  if (newlineIndex === -1) {
    return null;
  }

  return text.slice(newlineIndex + 1);
}

function splitPatchLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * Build a unified diff that shows only the appended chunk, anchored at the end
 * of the previous content, without materializing the full file. When the
 * previous content does not end with a newline and its trailing line is known,
 * the patch exactly models the merge of that line with the chunk's first line.
 */
function createAppendChunkPatch(
  remotePath: string,
  chunkText: string,
  stat: RemoteFileStat,
  trailingLine: string | null,
): string {
  const header = [
    `Index: ${remotePath}`,
    "===================================================================",
    `--- ${remotePath}\tbefore`,
    `+++ ${remotePath}\tafter`,
  ].join("\n");

  if (chunkText.length === 0) {
    return `${header}\n`;
  }

  const mergesTrailingLine = stat.bytes > 0 && !stat.endsWithNewline;

  if (mergesTrailingLine && trailingLine !== null) {
    // Exact form: the previous trailing line is replaced by itself merged with
    // the appended chunk.
    const mergedLines = splitPatchLines(`${trailingLine}${chunkText}`);
    const trailingLineNumber = stat.newlineCount + 1;
    const body = [`-${trailingLine}`, ...mergedLines.map((line) => `+${line}`)].join("\n");
    return `${header}\n@@ -${trailingLineNumber},1 +${trailingLineNumber},${mergedLines.length} @@\n${body}\n`;
  }

  const lines = splitPatchLines(chunkText);
  if (lines.length === 0) {
    return `${header}\n`;
  }

  // Insertion-only form. When the trailing line could not be reconstructed the
  // anchor is approximate; the diff is flagged as truncated either way.
  const anchor = stat.newlineCount + (mergesTrailingLine ? 1 : 0);
  const body = lines.map((line) => `+${line}`).join("\n");
  return `${header}\n@@ -${anchor},0 +${anchor + 1},${lines.length} @@\n${body}\n`;
}

interface WriteExecutionContext {
  sandbox: DaytonaSandbox;
  remotePath: string;
  fileContent: string;
  mode: WriteMode;
  sandboxOptions: SandboxSessionOptions;
}

/** Original path: exact full-file diff for new and reasonably sized files. */
async function writeWithFullDiff(context: WriteExecutionContext, chunk: Buffer, stat: RemoteFileStat) {
  const { sandbox, remotePath, fileContent, mode, sandboxOptions } = context;
  const previousContent = stat.exists ? await readRemoteTextIfPresent(sandbox, remotePath) : null;
  const nextContent = mode === "append" ? `${previousContent ?? ""}${fileContent}` : fileContent;
  const content = Buffer.from(nextContent, "utf8");
  const diff: WriteDiff = {
    renderer: "pierre",
    fileName: remotePath,
    patch: createTwoFilesPatch(remotePath, remotePath, previousContent ?? "", nextContent, "before", "after"),
    status: previousContent === null ? "added" : "modified",
  };

  if (previousContent === nextContent) {
    return {
      content: `No changes needed for ${remotePath}; content already matched.`,
      details: {
        path: remotePath,
        mode,
        bytesWritten: 0,
        contentBytes: chunk.length,
        fileBytes: content.length,
        unchanged: true,
        diff,
      },
    };
  }

  if (previousContent === null) {
    await ensureRemoteParentDirectory(remotePath, sandboxOptions);
  }

  await sandbox.fs.uploadFile(content, remotePath);

  return {
    content:
      mode === "append"
        ? `Appended ${chunk.length} bytes to ${remotePath} (${content.length} bytes total).`
        : `Wrote ${content.length} bytes to ${remotePath}.`,
    details: {
      path: remotePath,
      mode,
      // bytesWritten is always the size of this call's chunk; fileBytes carries
      // the resulting total file size.
      bytesWritten: chunk.length,
      contentBytes: chunk.length,
      fileBytes: content.length,
      previousExists: previousContent !== null,
      unchanged: false,
      diff,
    },
  };
}

/** Large-file append: remote-side append, chunk-only diff, no full download/upload. */
async function appendToLargeFile(context: WriteExecutionContext, chunk: Buffer, stat: RemoteFileStat) {
  const { remotePath, fileContent, sandboxOptions } = context;

  if (chunk.length === 0) {
    return {
      content: `No changes needed for ${remotePath}; append chunk was empty.`,
      details: {
        path: remotePath,
        mode: "append" as const,
        bytesWritten: 0,
        contentBytes: 0,
        fileBytes: stat.bytes,
        unchanged: true,
        diffTruncated: true,
        diff: {
          renderer: "pierre",
          fileName: remotePath,
          patch: createAppendChunkPatch(remotePath, fileContent, stat, null),
          status: "modified",
          truncated: true,
        } satisfies WriteDiff,
      },
    };
  }

  // When the previous content does not end with a newline, reconstruct its
  // trailing line with a bounded read so the chunk diff is exact.
  const trailingLine =
    stat.bytes > 0 && !stat.endsWithNewline ? await readRemoteTrailingLine(remotePath, sandboxOptions) : null;
  const diff: WriteDiff = {
    renderer: "pierre",
    fileName: remotePath,
    patch: createAppendChunkPatch(remotePath, fileContent, stat, trailingLine),
    status: "modified",
    truncated: true,
  };

  await appendRemoteChunk(remotePath, chunk, sandboxOptions);

  return {
    content: `Appended ${chunk.length} bytes to ${remotePath} (${formatSize(stat.bytes + chunk.length)} total). Large file: diff shows only the appended chunk.`,
    details: {
      path: remotePath,
      mode: "append" as const,
      bytesWritten: chunk.length,
      contentBytes: chunk.length,
      fileBytes: stat.bytes + chunk.length,
      previousExists: true,
      unchanged: false,
      diffTruncated: true,
      diff,
    },
  };
}

/** Large-file overwrite: upload directly without downloading or diffing the previous content. */
async function overwriteLargeFile(context: WriteExecutionContext, chunk: Buffer, stat: RemoteFileStat) {
  const { sandbox, remotePath, fileContent } = context;

  await sandbox.fs.uploadFile(chunk, remotePath);

  return {
    content: `Wrote ${chunk.length} bytes to ${remotePath}, replacing ${formatSize(stat.bytes)} of previous content. Large file: previous content was not diffed.`,
    details: {
      path: remotePath,
      mode: "overwrite" as const,
      bytesWritten: chunk.length,
      contentBytes: chunk.length,
      fileBytes: chunk.length,
      previousExists: true,
      unchanged: false,
      diffTruncated: true,
      diff: {
        renderer: "pierre",
        fileName: remotePath,
        patch: createTwoFilesPatch(remotePath, remotePath, "", fileContent, "before", "after"),
        status: "modified",
        truncated: true,
      } satisfies WriteDiff,
    },
  };
}

async function performWrite(context: WriteExecutionContext) {
  const chunk = Buffer.from(context.fileContent, "utf8");
  const stat = await statRemoteFile(context.remotePath, context.sandboxOptions);

  if (stat.exists && stat.bytes > MAX_DIFF_SOURCE_BYTES) {
    return context.mode === "append"
      ? appendToLargeFile(context, chunk, stat)
      : overwriteLargeFile(context, chunk, stat);
  }

  return writeWithFullDiff(context, chunk, stat);
}

async function executeDaytonaWrite(input: WriteInput, sandboxOptions: SandboxSessionOptions) {
  "use step";

  const path = requireString(input.path, "path", "write");
  const fileContent = requireString(input.content, "content", "write", { allowEmpty: true });
  const mode: WriteMode = input.mode ?? "overwrite";
  const deadline = createWriteDeadline(WRITE_DEADLINE_MS);
  const context = await deadline.run("starting the sandbox", () => getSandboxContext(sandboxOptions));
  const remotePath = resolveSandboxPath(path, context.workDir);

  // The queue owns both timeouts: the caller fails fast, but the queue stays
  // locked until the actual mutation settles so a timed-out write can never
  // overlap a later write to the same file.
  return withFileMutationQueue(
    createFileMutationQueueKey(context.sandbox.id, remotePath),
    () => performWrite({ sandbox: context.sandbox, remotePath, fileContent, mode, sandboxOptions }),
    {
      waitTimeoutMs: () => deadline.remainingMs(),
      createWaitTimeoutError: () => createWriteTimeoutError(`waiting for other pending writes to ${remotePath}`),
      runTimeoutMs: () => deadline.remainingMs(),
      createRunTimeoutError: () => createWriteTimeoutError(`writing ${remotePath}`),
    },
  );
}

export function createDaytonaWriteTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "write",
    description:
      `Create, fully overwrite, or append to a text file in the Daytona sandbox. Use mode=overwrite for new files or complete rewrites when exact edit replacement is impractical. Use mode=append for subsequent chunks when a generated file is too large for one call; appends to large files are applied remotely so each chunk stays fast regardless of file size. Each content payload is limited to ${MAX_WRITE_CONTENT_CHARS} characters. Automatically creates parent directories, skips uploads when content already matches, mutates files, and returns a diff (limited to the changed chunk for very large files); prefer edit for small changes to existing files.`,
    inputSchema: writeInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaWrite(input, sandboxOptions),
  });
}
