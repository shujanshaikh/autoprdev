import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { ensureRemoteParentDirectory, resolveSandboxPath } from "../sandbox/execute";
import { toTextModelOutput } from "./format";

const writeInputSchema = z.object({
  path: z.string().describe("Path to the file to write. Relative paths resolve from the sandbox workdir."),
  content: z.string().describe("Full file contents to write."),
});

type WriteInput = z.infer<typeof writeInputSchema>;

async function executeDaytonaWrite(input: WriteInput, sandboxOptions: SandboxSessionOptions) {
  "use step";

  const context = await getSandboxContext(sandboxOptions);
  const remotePath = resolveSandboxPath(input.path, context.workDir);
  let previousContent: string | null = null;

  try {
    const previousBuffer = Buffer.from(await context.sandbox.fs.downloadFile(remotePath));
    previousContent = previousBuffer.toString("utf8");
  } catch {
    previousContent = null;
  }

  const content = Buffer.from(input.content, "utf8");

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
        oldContent: previousContent,
        newContent: input.content,
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
