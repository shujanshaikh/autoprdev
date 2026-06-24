import { tool } from "ai";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";

import { getSandboxContext, type DaytonaSandbox, type SandboxSessionOptions } from "../sandbox";
import { ensureRemoteParentDirectory, resolveSandboxPath } from "../sandbox/execute";
import { createFileMutationQueueKey, withFileMutationQueue } from "./file-mutation-queue";
import { toTextModelOutput } from "./format";
import { requireString } from "./validation";

const writeInputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe("Required. Path to the file to write. Relative paths resolve from the sandbox workdir."),
  content: z.string().optional().describe("Required. Full file contents to write."),
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
  "use step";

  const path = requireString(input.path, "path", "write");
  const fileContent = requireString(input.content, "content", "write", { allowEmpty: true });
  const context = await getSandboxContext(sandboxOptions);
  const remotePath = resolveSandboxPath(path, context.workDir);

  return withFileMutationQueue(createFileMutationQueueKey(context.sandbox.id, remotePath), async () => {
    const previousContent = await readRemoteTextIfPresent(context.sandbox, remotePath);
    const content = Buffer.from(fileContent, "utf8");
    const patch = createTwoFilesPatch(remotePath, remotePath, previousContent ?? "", fileContent, "before", "after");

    if (previousContent === fileContent) {
      return {
        content: `No changes needed for ${remotePath}; content already matched.`,
        details: {
          path: remotePath,
          bytesWritten: 0,
          contentBytes: content.length,
          unchanged: true,
          diff: {
            renderer: "pierre",
            fileName: remotePath,
            patch,
            oldContent: previousContent,
            newContent: fileContent,
          },
        },
      };
    }

    await ensureRemoteParentDirectory(remotePath, sandboxOptions);
    await context.sandbox.fs.uploadFile(content, remotePath);

    return {
      content: `Wrote ${content.length} bytes to ${remotePath}.`,
      details: {
        path: remotePath,
        bytesWritten: content.length,
        previousExists: previousContent !== null,
        unchanged: false,
        diff: {
          renderer: "pierre",
          fileName: remotePath,
          patch,
          oldContent: previousContent,
          newContent: fileContent,
        },
      },
    };
  });
}

export function createDaytonaWriteTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "write",
    description:
      "Create or fully overwrite a text file in the Daytona sandbox. Use for new files or complete rewrites when exact edit replacement is impractical. Automatically creates parent directories, skips uploads when content already matches, mutates files, and returns a diff; prefer edit for small changes to existing files.",
    inputSchema: writeInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaWrite(input, sandboxOptions),
  });
}
