import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { toTextModelOutput } from "./format";

const sandboxInfoInputSchema = z.object({});

async function executeDaytonaSandboxInfo(sandboxOptions: SandboxSessionOptions) {
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
    description:
      "Inspect the active Daytona sandbox metadata. Use when you need the sandbox id, name, snapshot, or working directory before choosing paths, commands, previews, or follow-up actions. Read-only and safe to retry.",
    inputSchema: sandboxInfoInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: () => executeDaytonaSandboxInfo(sandboxOptions),
  });
}
