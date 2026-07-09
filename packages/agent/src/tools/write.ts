import { posix as path } from "node:path";

import { tool, type ToolExecutionOptions } from "ai";
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
import {
  assertWriteTransactionIdentity,
  classifyWriteTransactionRetry,
  createWriteIdempotencyKey,
  fingerprintsEqual,
  isWriteTransactionRecord,
  sha256Hex,
  type FileFingerprint,
  type WriteTransactionIdentity,
  type WriteTransactionRecord,
} from "./write-transaction";

const MAX_WRITE_CONTENT_CHARS = 20_000;

// Total time budget for one write call. A slow sandbox operation fails with an
// actionable error while the durable transaction record remains available for
// a safe retry.
const WRITE_DEADLINE_MS = 4 * 60 * 1000;

// Existing files larger than this are never downloaded for diffing. Their
// atomic candidates are assembled inside the sandbox, avoiding a full-file
// network round trip even though the remote filesystem must copy the file.
const MAX_DIFF_SOURCE_BYTES = 256 * 1024;

const STAT_COMMAND_TIMEOUT_SECONDS = 30;
const FILE_TRANSACTION_TIMEOUT_SECONDS = 90;
const WRITE_TRANSACTION_ROOT = "/home/daytona/.autopr/write-idempotency";

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
      `Required. File content for this write call. Maximum ${MAX_WRITE_CONTENT_CHARS} characters. Keep this payload small and bounded; never send a huge complete file. For large new files or unavoidable full rewrites, make multiple sequential write calls: mode=overwrite for the first chunk, then mode=append for later chunks.`,
    ),
  mode: z
    .enum(["overwrite", "append"])
    .optional()
    .describe(
      "Write mode. Defaults to overwrite. Use overwrite for new files or the first chunk of an unavoidable full rewrite; use append for subsequent chunks.",
    ),
  expectedOffset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Optional append safety check. The target must contain exactly this many bytes before the chunk is appended.",
    ),
  expectedHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional()
    .describe(
      "Optional append safety check. SHA-256 of the complete target file before this chunk is appended.",
    ),
  contentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional()
    .describe("Optional SHA-256 of this call's content. The write is rejected if the payload hash differs."),
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
    `write timed out while ${phase} (budget: ${Math.round(WRITE_DEADLINE_MS / 1000)}s). ` +
      "No file mutation for this call was started.",
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

interface RemoteFileStat extends FileFingerprint {
  exists: boolean;
  bytes: number;
  newlineCount: number;
  endsWithNewline: boolean;
  sha256?: string;
}

/**
 * Inspect the remote file with one cheap shell command instead of downloading
 * it, so writes to large files never pay a full-content round trip up front.
 */
async function statRemoteFile(remotePath: string, sandboxOptions: SandboxSessionOptions): Promise<RemoteFileStat> {
  const quoted = shellQuote(remotePath);
  const result = await executeSandboxCommand(
    `if [ -e ${quoted} ]; then printf 'exists %s %s %s %s\\n' "$(wc -c < ${quoted})" "$(wc -l < ${quoted})" "$(tail -c 1 ${quoted} | wc -l)" "$(sha256sum ${quoted} | cut -d ' ' -f 1)"; else printf 'missing\\n'; fi`,
    { cwd: "/", timeout: STAT_COMMAND_TIMEOUT_SECONDS, sandboxOptions },
  );
  const output = (result.stdout ?? result.output ?? "").trim();

  if (result.timedOut || result.exitCode !== 0) {
    throw new Error(`write could not inspect ${remotePath}: ${result.stderr?.trim() || output || "unknown error"}`);
  }

  const match = /exists\s+(\d+)\s+(\d+)\s+(\d+)\s+([a-f0-9]{64})/i.exec(output);
  if (match) {
    return {
      exists: true,
      bytes: Number(match[1]),
      newlineCount: Number(match[2]),
      endsWithNewline: match[3] === "1",
      sha256: match[4]!.toLowerCase(),
    };
  }

  if (output.includes("missing")) {
    return { exists: false, bytes: 0, newlineCount: 0, endsWithNewline: false };
  }

  throw new Error(`write could not parse file metadata for ${remotePath}.`);
}

interface WriteTransactionPaths {
  marker: string;
  markerTemp: string;
  chunk: string;
  candidate: string;
  lock: string;
}

function transactionPaths(remotePath: string, idempotencyKey: string): WriteTransactionPaths {
  return {
    marker: `${WRITE_TRANSACTION_ROOT}/${idempotencyKey}.json`,
    markerTemp: `${WRITE_TRANSACTION_ROOT}/${idempotencyKey}.json.tmp`,
    chunk: `${WRITE_TRANSACTION_ROOT}/${idempotencyKey}.chunk`,
    candidate: path.join(path.dirname(remotePath), `.autopr-write-${idempotencyKey}.tmp`),
    lock: `${WRITE_TRANSACTION_ROOT}/locks/${sha256Hex(remotePath)}.lock`,
  };
}

function fingerprintFromStat(stat: RemoteFileStat): FileFingerprint {
  return {
    exists: stat.exists,
    bytes: stat.bytes,
    sha256: stat.sha256,
  };
}

function assertFingerprintCommand(remotePath: string, fingerprint: FileFingerprint): string {
  const quotedPath = shellQuote(remotePath);

  if (!fingerprint.exists) {
    return `test ! -e ${quotedPath}`;
  }

  if (!fingerprint.sha256) {
    throw new Error(`write could not validate ${remotePath} without a SHA-256 fingerprint`);
  }

  return [
    `test -e ${quotedPath}`,
    `test "$(wc -c < ${quotedPath})" = ${shellQuote(String(fingerprint.bytes))}`,
    `test "$(sha256sum ${quotedPath} | cut -d ' ' -f 1)" = ${shellQuote(fingerprint.sha256)}`,
  ].join(" && ");
}

async function readWriteTransactionRecord(
  sandbox: DaytonaSandbox,
  markerPath: string,
): Promise<WriteTransactionRecord | null> {
  const text = await readRemoteTextIfPresent(sandbox, markerPath);
  if (text === null) {
    return null;
  }

  const record: unknown = JSON.parse(text);
  if (!isWriteTransactionRecord(record)) {
    throw new Error(`write found an invalid idempotency record at ${markerPath}`);
  }

  return record;
}

async function writeTransactionRecord(
  sandbox: DaytonaSandbox,
  paths: WriteTransactionPaths,
  record: WriteTransactionRecord,
  sandboxOptions: SandboxSessionOptions,
) {
  await ensureRemoteParentDirectory(paths.marker, sandboxOptions);
  await sandbox.fs.uploadFile(Buffer.from(JSON.stringify(record), "utf8"), paths.markerTemp);
  const result = await executeSandboxCommand(
    `mv -f -- ${shellQuote(paths.markerTemp)} ${shellQuote(paths.marker)}`,
    { cwd: "/", timeout: STAT_COMMAND_TIMEOUT_SECONDS, sandboxOptions },
  );

  if (result.timedOut || result.exitCode !== 0) {
    throw new Error(
      `write could not persist idempotency record ${record.idempotencyKey}: ` +
        `${result.stderr?.trim() || result.output?.trim() || "unknown error"}`,
    );
  }
}

async function markTransactionCommittedBestEffort(
  sandbox: DaytonaSandbox,
  paths: WriteTransactionPaths,
  record: WriteTransactionRecord,
  sandboxOptions: SandboxSessionOptions,
) {
  try {
    await writeTransactionRecord(sandbox, paths, { ...record, state: "committed" }, sandboxOptions);
  } catch (error) {
    // A prepared record plus a final target fingerprint is enough to dedupe a
    // retry. Do not turn a confirmed file commit into an ambiguous tool error
    // merely because the bookkeeping state could not be advanced.
    console.warn(`write committed ${record.remotePath} but could not finalize its idempotency record`, error);
  }
}

async function buildAtomicCandidate(
  paths: WriteTransactionPaths,
  remotePath: string,
  mode: WriteMode,
  initial: FileFingerprint,
  sandboxOptions: SandboxSessionOptions,
): Promise<FileFingerprint> {
  const quotedTarget = shellQuote(remotePath);
  const quotedCandidate = shellQuote(paths.candidate);
  const quotedChunk = shellQuote(paths.chunk);
  const body = [
    "set -eu",
    assertFingerprintCommand(remotePath, initial),
    `rm -f -- ${quotedCandidate}`,
    mode === "append" && initial.exists
      ? `cp -- ${quotedTarget} ${quotedCandidate}`
      : mode === "append"
        ? `: > ${quotedCandidate}`
        : `cp -- ${quotedChunk} ${quotedCandidate}`,
    mode === "append" ? `cat -- ${quotedChunk} >> ${quotedCandidate}` : undefined,
    initial.exists ? `chmod --reference=${quotedTarget} ${quotedCandidate}` : undefined,
    `printf 'candidate %s %s\\n' "$(wc -c < ${quotedCandidate})" "$(sha256sum ${quotedCandidate} | cut -d ' ' -f 1)"`,
  ]
    .filter(Boolean)
    .join("; ");
  const result = await executeSandboxCommand(
    `flock ${shellQuote(paths.lock)} -c ${shellQuote(body)}`,
    { cwd: "/", timeout: FILE_TRANSACTION_TIMEOUT_SECONDS, sandboxOptions },
  );
  const output = (result.stdout ?? result.output ?? "").trim();

  if (result.timedOut || result.exitCode !== 0) {
    throw new Error(
      `write refused to prepare ${remotePath} because its offset/hash changed: ` +
        `${result.stderr?.trim() || output || "unknown error"}`,
    );
  }

  const match = /candidate\s+(\d+)\s+([a-f0-9]{64})/i.exec(output);
  if (!match) {
    throw new Error(`write could not parse the atomic candidate fingerprint for ${remotePath}`);
  }

  return {
    exists: true,
    bytes: Number(match[1]),
    sha256: match[2]!.toLowerCase(),
  };
}

async function commitAtomicCandidate(
  paths: WriteTransactionPaths,
  remotePath: string,
  initial: FileFingerprint,
  final: FileFingerprint,
  sandboxOptions: SandboxSessionOptions,
) {
  const body = [
    "set -eu",
    assertFingerprintCommand(remotePath, initial),
    assertFingerprintCommand(paths.candidate, final),
    `mv -f -- ${shellQuote(paths.candidate)} ${shellQuote(remotePath)}`,
  ].join("; ");
  const result = await executeSandboxCommand(
    `flock ${shellQuote(paths.lock)} -c ${shellQuote(body)}`,
    { cwd: "/", timeout: FILE_TRANSACTION_TIMEOUT_SECONDS, sandboxOptions },
  );

  if (result.timedOut || result.exitCode !== 0) {
    const current = fingerprintFromStat(await statRemoteFile(remotePath, sandboxOptions));
    if (fingerprintsEqual(current, final)) {
      return;
    }

    throw new Error(
      `write refused to commit ${remotePath} because its offset/hash changed: ` +
        `${result.stderr?.trim() || result.output?.trim() || "unknown error"}`,
    );
  }
}

async function cleanupTransactionFiles(
  paths: WriteTransactionPaths,
  sandboxOptions: SandboxSessionOptions,
) {
  await executeSandboxCommand(
    `rm -f -- ${shellQuote(paths.chunk)} ${shellQuote(paths.candidate)} ${shellQuote(paths.markerTemp)}`,
    { cwd: "/", timeout: STAT_COMMAND_TIMEOUT_SECONDS, sandboxOptions },
  ).catch(() => undefined);
}

function validateExpectedInput(
  input: WriteInput,
  mode: WriteMode,
  fingerprint: FileFingerprint,
  contentSha256: string,
) {
  if (input.contentHash && input.contentHash.toLowerCase() !== contentSha256) {
    throw new Error(
      `write content hash mismatch: expected ${input.contentHash.toLowerCase()}, received ${contentSha256}`,
    );
  }

  if (mode !== "append" && (input.expectedOffset !== undefined || input.expectedHash !== undefined)) {
    throw new Error("write expectedOffset and expectedHash are only valid with mode=append");
  }

  if (input.expectedOffset !== undefined && fingerprint.bytes !== input.expectedOffset) {
    throw new Error(
      `write append offset mismatch for target: expected ${input.expectedOffset} bytes, found ${fingerprint.bytes}`,
    );
  }

  if (input.expectedHash && fingerprint.sha256 !== input.expectedHash.toLowerCase()) {
    throw new Error(
      `write append hash mismatch for target: expected ${input.expectedHash.toLowerCase()}, ` +
        `found ${fingerprint.sha256 ?? "missing file"}`,
    );
  }
}

function addTransactionDetails(
  result: Awaited<ReturnType<typeof performWrite>>,
  record: Pick<WriteTransactionRecord, "idempotencyKey" | "contentSha256" | "initial" | "final">,
  idempotentReplay = false,
) {
  return {
    ...result,
    content: idempotentReplay
      ? `No changes needed for ${result.details.path}; this write call was already committed.`
      : result.content,
    details: {
      ...result.details,
      ...(idempotentReplay
        ? { bytesWritten: 0, unchanged: true, idempotentReplay: true }
        : {}),
      idempotencyKey: record.idempotencyKey,
      contentSha256: record.contentSha256,
      appendOffset: record.initial.bytes,
      previousSha256: record.initial.sha256,
      fileSha256: record.final.sha256,
      fileBytes: record.final.bytes,
    },
  };
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
  const { sandbox, remotePath, fileContent, mode } = context;
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

/** Large-file append preview: chunk-only diff without downloading the full file. */
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

/** Large-file overwrite preview without downloading or diffing the previous content. */
async function overwriteLargeFile(context: WriteExecutionContext, chunk: Buffer, stat: RemoteFileStat) {
  const { remotePath, fileContent } = context;

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

async function performWrite(context: WriteExecutionContext, stat: RemoteFileStat) {
  const chunk = Buffer.from(context.fileContent, "utf8");

  if (stat.exists && stat.bytes > MAX_DIFF_SOURCE_BYTES) {
    return context.mode === "append"
      ? appendToLargeFile(context, chunk, stat)
      : overwriteLargeFile(context, chunk, stat);
  }

  return writeWithFullDiff(context, chunk, stat);
}

async function performIdempotentWrite(
  input: WriteInput,
  executionOptions: ToolExecutionOptions,
  context: WriteExecutionContext,
) {
  const { sandbox, remotePath, fileContent, mode, sandboxOptions } = context;
  const runId = sandboxOptions.runId;
  if (!runId) {
    throw new Error("write requires a stable runId so retries can be deduplicated safely");
  }

  const chunk = Buffer.from(fileContent, "utf8");
  const contentSha256 = sha256Hex(chunk);
  const idempotencyKey = createWriteIdempotencyKey(runId, executionOptions.toolCallId);
  const paths = transactionPaths(remotePath, idempotencyKey);
  const identity: WriteTransactionIdentity = {
    runId,
    toolCallId: executionOptions.toolCallId,
    remotePath,
    mode,
    contentSha256,
  };
  const currentStat = await statRemoteFile(remotePath, sandboxOptions);
  const current = fingerprintFromStat(currentStat);
  const existing = await readWriteTransactionRecord(sandbox, paths.marker);

  if (existing) {
    if (existing.idempotencyKey !== idempotencyKey) {
      throw new Error(`write found an idempotency record under the wrong key at ${paths.marker}`);
    }
    assertWriteTransactionIdentity(existing, identity);
    validateExpectedInput(input, mode, existing.initial, contentSha256);
    const retryState = classifyWriteTransactionRetry(existing, current);

    if (retryState === "already-committed") {
      if (existing.state !== "committed") {
        await markTransactionCommittedBestEffort(sandbox, paths, existing, sandboxOptions);
      }
      await cleanupTransactionFiles(paths, sandboxOptions);
      return addTransactionDetails(
        existing.result as Awaited<ReturnType<typeof performWrite>>,
        existing,
        true,
      );
    }

    await ensureRemoteParentDirectory(remotePath, sandboxOptions);
    await ensureRemoteParentDirectory(paths.lock, sandboxOptions);
    await sandbox.fs.uploadFile(chunk, paths.chunk);
    const rebuiltFinal = await buildAtomicCandidate(paths, remotePath, mode, existing.initial, sandboxOptions);
    if (!fingerprintsEqual(rebuiltFinal, existing.final)) {
      throw new Error(
        `write retry candidate hash mismatch for idempotency key ${idempotencyKey}`,
      );
    }

    await commitAtomicCandidate(paths, remotePath, existing.initial, existing.final, sandboxOptions);
    await markTransactionCommittedBestEffort(sandbox, paths, existing, sandboxOptions);
    await cleanupTransactionFiles(paths, sandboxOptions);
    return existing.result as Awaited<ReturnType<typeof performWrite>>;
  }

  validateExpectedInput(input, mode, current, contentSha256);
  const result = await performWrite(context, currentStat);
  await ensureRemoteParentDirectory(remotePath, sandboxOptions);
  await ensureRemoteParentDirectory(paths.lock, sandboxOptions);
  await sandbox.fs.uploadFile(chunk, paths.chunk);
  const final = await buildAtomicCandidate(paths, remotePath, mode, current, sandboxOptions);
  const transactionResult = addTransactionDetails(result, {
    idempotencyKey,
    contentSha256,
    initial: current,
    final,
  });
  const record: WriteTransactionRecord = {
    version: 1,
    idempotencyKey,
    state: "prepared",
    ...identity,
    initial: current,
    final,
    result: transactionResult,
  };

  await writeTransactionRecord(sandbox, paths, record, sandboxOptions);
  await commitAtomicCandidate(paths, remotePath, current, final, sandboxOptions);
  await markTransactionCommittedBestEffort(sandbox, paths, record, sandboxOptions);
  await cleanupTransactionFiles(paths, sandboxOptions);
  return transactionResult;
}

async function executeDaytonaWrite(
  input: WriteInput,
  sandboxOptions: SandboxSessionOptions,
  executionOptions: ToolExecutionOptions,
) {

  const path = requireString(input.path, "path", "write");
  const fileContent = requireString(input.content, "content", "write", { allowEmpty: true });
  const mode: WriteMode = input.mode ?? "overwrite";
  const deadline = createWriteDeadline(WRITE_DEADLINE_MS);
  const context = await deadline.run("starting the sandbox", () => getSandboxContext(sandboxOptions));
  const remotePath = resolveSandboxPath(path, context.workDir);

  // Waiting for a predecessor is bounded because this call has not mutated
  // anything yet. Once our transaction begins, keep awaiting it: returning an
  // ambiguous timeout could prompt a new tool-call ID and duplicate an append.
  return withFileMutationQueue(
    createFileMutationQueueKey(context.sandbox.id, remotePath),
    () => performIdempotentWrite(
      input,
      executionOptions,
      { sandbox: context.sandbox, remotePath, fileContent, mode, sandboxOptions },
    ),
    {
      waitTimeoutMs: () => deadline.remainingMs(),
      createWaitTimeoutError: () => createWriteTimeoutError(`waiting for other pending writes to ${remotePath}`),
    },
  );
}

export function createDaytonaWriteTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "write",
    description:
      `Create, atomically overwrite, or retry-safely append to a text file in the Daytona sandbox with bounded payloads. Every call is persisted under an idempotency key derived from the Trigger.dev run ID and tool-call ID; a retry validates the recorded offsets and SHA-256 hashes instead of appending twice. Use mode=overwrite for new files or the first chunk of an unavoidable complete rewrite when exact edit replacement is impractical. Use mode=append for subsequent chunks. You may provide expectedOffset, expectedHash, and contentHash for additional chunk validation. Each content payload is limited to ${MAX_WRITE_CONTENT_CHARS} characters. Prefer multiple smaller files when the format allows it, prefer edit for localized changes to existing files, and never fully rewrite a large existing file just because the full content is available. Automatically creates parent directories, skips already committed calls, and returns a diff (limited to the changed chunk for very large files).`,
    inputSchema: writeInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input, executionOptions) => executeDaytonaWrite(input, sandboxOptions, executionOptions),
  });
}
