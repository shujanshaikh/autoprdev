import { tool } from "ai";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { ensureRemoteParentDirectory, resolveSandboxPath } from "../sandbox/execute";
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

async function executeDaytonaWrite(input: WriteInput, sandboxOptions: SandboxSessionOptions) {
  "use step";

  const path = requireString(input.path, "path", "write");
  const fileContent = requireString(input.content, "content", "write", { allowEmpty: true });
  const context = await getSandboxContext(sandboxOptions);
  const remotePath = resolveSandboxPath(path, context.workDir);
  let previousContent: string | null = null;

  try {
    const previousBuffer = Buffer.from(await context.sandbox.fs.downloadFile(remotePath));
    previousContent = previousBuffer.toString("utf8");
  } catch {
    previousContent = null;
  }

  const content = Buffer.from(fileContent, "utf8");

  await ensureRemoteParentDirectory(remotePath, sandboxOptions);
  await context.sandbox.fs.uploadFile(content, remotePath);

  return {
    content: `Wrote ${content.length} bytes to ${remotePath}.`,
    details: {
      path: remotePath,
      bytesWritten: content.length,
      diff: {
        renderer: "pierre",
        fileName: remotePath,
        patch: createTwoFilesPatch(remotePath, remotePath, previousContent ?? "", fileContent, "before", "after"),
        oldContent: previousContent,
        newContent: fileContent,
      },
    },
  };
}

export function createDaytonaWriteTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "write",
    description: "Create or fully overwrite a file in the Daytona sandbox.",
    inputSchema: writeInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaWrite(input, sandboxOptions),
  });
}
