import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { toTextModelOutput } from "./format";

const sandboxInfoInputSchema = z.object({});

async function executeDaytonaSandboxInfo(sandboxOptions: SandboxSessionOptions) {
  "use step";

  const context = await getSandboxContext(sandboxOptions);

  return {
    content:
      `Sandbox ID: ${context.sandbox.id}\n` +
      `Sandbox name: ${context.sandbox.name ?? "(unnamed)"}\n` +
      `Snapshot: ${context.sandbox.snapshot ?? "(unknown)"}\n` +
      `Working directory: ${context.workDir}`,
    details: {
      sandboxId: context.sandbox.id,
      sandboxName: context.sandbox.name ?? null,
      snapshot: context.sandbox.snapshot ?? null,
      workDir: context.workDir,
    },
  };
}

export function createDaytonaSandboxInfoTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "sandboxInfo",
    description: "Return the current Daytona sandbox id, name, snapshot, and working directory.",
    inputSchema: sandboxInfoInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: () => executeDaytonaSandboxInfo(sandboxOptions),
  });
}
