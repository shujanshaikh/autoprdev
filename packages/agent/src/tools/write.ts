import { tool } from "ai";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import {
  downloadRemoteFileChunk,
  ensureRemoteParentDirectory,
  RemoteFileNotFoundError,
  resolveJailedSandboxPath,
} from "../sandbox/execute";
import { createFileMutationQueueKey, withFileMutationQueue } from "./file-mutation-queue";
import { formatSize, toTextModelOutput } from "./format";

// Previous content is only fetched to diff and to detect no-op writes, so cap
// it: larger existing files are overwritten without a stored patch instead of
// being buffered whole into harness memory.
const MAX_PREVIOUS_CONTENT_BYTES = 1024 * 1024;

const writeInputSchema = z.object({
  path: z
    .string()
    .describe("Path to the file to write. Relative paths resolve from the Daytona sandbox workdir."),
  content: z.string().describe("Complete text content to write to the file."),
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
          status,
        }
      : {
          renderer: "pierre" as const,
          fileName: remotePath,
          patch: createTwoFilesPatch(remotePath, remotePath, previous?.text ?? "", input.content, "before", "after"),
          status,
        };

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

    const oversizedNote = previous !== null && !previous.complete
      ? ` Previous content exceeded ${formatSize(MAX_PREVIOUS_CONTENT_BYTES)}, so no diff was stored.`
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
  });
}

export function createDaytonaWriteTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "write",
    description:
      "Write complete text content to a file in the Daytona sandbox. Creates the file if it does not exist and overwrites it if it does. Automatically creates parent directories and returns a diff. Paths must stay inside the sandbox workspace. Use write only for new files or complete rewrites; use edit for targeted changes to existing files.",
    inputSchema: writeInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaWrite(input, sandboxOptions),
  });
}
