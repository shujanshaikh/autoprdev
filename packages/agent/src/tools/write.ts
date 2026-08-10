import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import {
  downloadRemoteFileChunk,
  ensureRemoteParentDirectory,
  RemoteFileNotFoundError,
  resolveJailedSandboxPath,
} from "../sandbox/execute";
import { createFileMutationQueueKey, withFileMutationQueue } from "./file-mutation-queue";
import { createBoundedToolDiff } from "./diff";
import { toTextModelOutput } from "./format";

// Previous content is only fetched to diff and to detect no-op writes, so cap
// it: larger existing files are overwritten without a stored patch instead of
// being buffered whole into harness memory.
const MAX_PREVIOUS_CONTENT_BYTES = 1024 * 1024;
const MAX_WRITE_CONTENT_BYTES = 10 * 1024 * 1024;
const FILE_MUTATION_WAIT_TIMEOUT_MS = 30_000;
const FILE_MUTATION_RUN_TIMEOUT_MS = 120_000;

const writeInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(4_096)
    .describe("Path to the file to write. Relative paths resolve from the Daytona sandbox workdir."),
  content: z.string().refine(
    (content) => Buffer.byteLength(content, "utf8") <= MAX_WRITE_CONTENT_BYTES,
    "File content must be at most 10 MiB.",
  ).describe("Complete text content to write to the file, up to 10 MiB."),
});

type WriteInput = z.infer<typeof writeInputSchema>;

type PreviousRemoteText = {
  text: string;
  /** False when the existing file exceeded the download cap and was cut off. */
  complete: boolean;
};

async function readRemoteTextIfPresent(
  remotePath: string,
  sandboxOptions: SandboxSessionOptions,
): Promise<PreviousRemoteText | null> {
  try {
    const chunk = await downloadRemoteFileChunk({
      remotePath,
      maxBytes: MAX_PREVIOUS_CONTENT_BYTES,
      sandboxOptions,
    });
    return {
      text: chunk.content.toString("utf8"),
      complete: chunk.totalBytes <= MAX_PREVIOUS_CONTENT_BYTES,
    };
  } catch (error) {
    if (error instanceof RemoteFileNotFoundError) {
      return null;
    }

    throw error;
  }
}

async function executeDaytonaWrite(input: WriteInput, sandboxOptions: SandboxSessionOptions) {
  const context = await getSandboxContext(sandboxOptions);
  const remotePath = await resolveJailedSandboxPath(input.path, {
    workDir: context.workDir,
    sandboxOptions,
  });

  return withFileMutationQueue(createFileMutationQueueKey(context.sandbox.id, remotePath), async () => {
    const previous = await readRemoteTextIfPresent(remotePath, sandboxOptions);
    const content = Buffer.from(input.content, "utf8");
    const status = previous === null ? "added" as const : "modified" as const;
    // A previous file beyond the download cap cannot produce a trustworthy
    // patch or no-op comparison; the UI renders patchOmitted diffs as a notice.
    const diff = previous !== null && !previous.complete
      ? {
          renderer: "pierre" as const,
          fileName: remotePath,
          patch: "",
          patchOmitted: true,
          patchOmittedReason: "source_too_large" as const,
          status,
        }
      : createBoundedToolDiff({
          path: remotePath,
          before: previous?.text ?? "",
          after: input.content,
          status,
        });

    if (previous?.complete && previous.text === input.content) {
      return {
        content: `No changes needed for ${remotePath}; content already matched.`,
        details: {
          path: remotePath,
          bytesWritten: 0,
          contentBytes: content.length,
          fileBytes: content.length,
          previousExists: true,
          unchanged: true,
          diff,
        },
      };
    }

    await ensureRemoteParentDirectory(remotePath, sandboxOptions);
    await context.sandbox.fs.uploadFile(content, remotePath);

    const oversizedNote = diff.patchOmitted
      ? ` The change was too large for a safe stored diff, so the diff preview was omitted.`
      : "";

    return {
      content: `Successfully wrote ${content.length} bytes to ${remotePath}.${oversizedNote}`,
      details: {
        path: remotePath,
        bytesWritten: content.length,
        contentBytes: content.length,
        fileBytes: content.length,
        previousExists: previous !== null,
        unchanged: false,
        diff,
      },
    };
  }, {
    waitTimeoutMs: FILE_MUTATION_WAIT_TIMEOUT_MS,
    runTimeoutMs: FILE_MUTATION_RUN_TIMEOUT_MS,
    createWaitTimeoutError: () => new Error(`Timed out waiting to write ${remotePath}; another edit is still running.`),
    createRunTimeoutError: () => new Error(`Timed out writing ${remotePath} in Daytona.`),
  });
}

export function createDaytonaWriteTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "write",
    description:
      "Write complete text content to a Daytona file, creating parents or overwriting as needed. Canonicalizes paths inside the workspace jail, skips identical writes, serializes same-file mutations, and omits oversized diff previews safely. Use for new files or intentional rewrites; use edit for targeted changes.",
    inputSchema: writeInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaWrite(input, sandboxOptions),
  });
}
