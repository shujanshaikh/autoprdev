import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { toTextModelOutput } from "./format";

const sandboxInfoInputSchema = z.object({});

async function executeDaytonaSandboxInfo(sandboxOptions: SandboxSessionOptions) {
  const context = await getSandboxContext(sandboxOptions);

  return {
    content:
      `Provider: ${context.provider === "e2b" ? "E2B" : "Daytona"}\n` +
      `Sandbox ID: ${context.sandbox.id}\n` +
      `Sandbox name: ${context.sandbox.name ?? "(unnamed)"}\n` +
      `Snapshot: ${context.sandbox.snapshot ?? "(unknown)"}\n` +
      `State: ${context.sandbox.state ?? "(unknown)"}\n` +
      `Auto-archive interval: ${context.sandbox.autoArchiveInterval ?? "(default)"}\n` +
      `Working directory: ${context.workDir}`,
    details: {
      provider: context.provider,
      sandboxId: context.sandbox.id,
      sandboxName: context.sandbox.name ?? null,
      snapshot: context.sandbox.snapshot ?? null,
      state: context.sandbox.state ?? null,
      autoArchiveInterval: context.sandbox.autoArchiveInterval ?? null,
      workDir: context.workDir,
    },
  };
}

export function createSandboxInfoTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "sandboxInfo",
    description:
      "Inspect the active sandbox metadata. Use when you need the provider, sandbox id, name, template, or working directory before choosing paths, commands, previews, or follow-up actions. Read-only and safe to retry.",
    inputSchema: sandboxInfoInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: () => executeDaytonaSandboxInfo(sandboxOptions),
  });
}

export const createDaytonaSandboxInfoTool = createSandboxInfoTool;
