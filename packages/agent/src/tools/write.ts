import { tool } from "ai";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";

import { getSandboxContext, type DaytonaSandbox, type SandboxSessionOptions } from "../sandbox";
import { ensureRemoteParentDirectory, resolveSandboxPath } from "../sandbox/execute";
import { createFileMutationQueueKey, withFileMutationQueue } from "./file-mutation-queue";
import { toTextModelOutput } from "./format";
import { requireString } from "./validation";

const MAX_WRITE_CONTENT_CHARS = 20_000;

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
  const mode = input.mode ?? "overwrite";
  const context = await getSandboxContext(sandboxOptions);
  const remotePath = resolveSandboxPath(path, context.workDir);

  return withFileMutationQueue(createFileMutationQueueKey(context.sandbox.id, remotePath), async () => {
    const previousContent = await readRemoteTextIfPresent(context.sandbox, remotePath);
    const nextContent = mode === "append" ? `${previousContent ?? ""}${fileContent}` : fileContent;
    const content = Buffer.from(nextContent, "utf8");
    const chunk = Buffer.from(fileContent, "utf8");
    const patch = createTwoFilesPatch(remotePath, remotePath, previousContent ?? "", nextContent, "before", "after");
    const diff = {
      renderer: "pierre" as const,
      fileName: remotePath,
      patch,
      status: previousContent === null ? "added" as const : "modified" as const,
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

    await ensureRemoteParentDirectory(remotePath, sandboxOptions);
    await context.sandbox.fs.uploadFile(content, remotePath);

    return {
      content:
        mode === "append"
          ? `Appended ${chunk.length} bytes to ${remotePath} (${content.length} bytes total).`
          : `Wrote ${content.length} bytes to ${remotePath}.`,
      details: {
        path: remotePath,
        mode,
        bytesWritten: content.length,
        contentBytes: chunk.length,
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
      `Create, fully overwrite, or append to a text file in the Daytona sandbox. Use mode=overwrite for new files or complete rewrites when exact edit replacement is impractical. Use mode=append for subsequent chunks when a generated file is too large for one call. Each content payload is limited to ${MAX_WRITE_CONTENT_CHARS} characters. Automatically creates parent directories, skips uploads when content already matches, mutates files, and returns a diff; prefer edit for small changes to existing files.`,
    inputSchema: writeInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaWrite(input, sandboxOptions),
  });
}
