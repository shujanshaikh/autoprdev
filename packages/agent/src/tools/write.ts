import { tool } from "ai";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";

import { getSandboxContext, type DaytonaSandbox, type SandboxSessionOptions } from "../sandbox";
import { ensureRemoteParentDirectory, resolveSandboxPath } from "../sandbox/execute";
import { createFileMutationQueueKey, withFileMutationQueue } from "./file-mutation-queue";
import { toTextModelOutput } from "./format";

const writeInputSchema = z.object({
  path: z
    .string()
    .describe("Path to the file to write. Relative paths resolve from the Daytona sandbox workdir."),
  content: z.string().describe("Complete text content to write to the file."),
});

type WriteInput = z.infer<typeof writeInputSchema>;

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

async function executeDaytonaWrite(input: WriteInput, sandboxOptions: SandboxSessionOptions) {
  const context = await getSandboxContext(sandboxOptions);
  const remotePath = resolveSandboxPath(input.path, context.workDir);

  return withFileMutationQueue(createFileMutationQueueKey(context.sandbox.id, remotePath), async () => {
    const previousContent = await readRemoteTextIfPresent(context.sandbox, remotePath);
    const content = Buffer.from(input.content, "utf8");
    const diff = {
      renderer: "pierre" as const,
      fileName: remotePath,
      patch: createTwoFilesPatch(remotePath, remotePath, previousContent ?? "", input.content, "before", "after"),
      status: previousContent === null ? "added" as const : "modified" as const,
    };

    if (previousContent === input.content) {
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

    return {
      content: `Successfully wrote ${content.length} bytes to ${remotePath}.`,
      details: {
        path: remotePath,
        bytesWritten: content.length,
        contentBytes: content.length,
        fileBytes: content.length,
        previousExists: previousContent !== null,
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
      "Write complete text content to a file in the Daytona sandbox. Creates the file if it does not exist and overwrites it if it does. Automatically creates parent directories and returns a diff. Use write only for new files or complete rewrites; use edit for targeted changes to existing files.",
    inputSchema: writeInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaWrite(input, sandboxOptions),
  });
}
