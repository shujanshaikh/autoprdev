import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { toTextModelOutput } from "./format";

const sandboxInfoInputSchema = z.object({});

async function executeDaytonaSandboxInfo(sandboxOptions: SandboxSessionOptions) {
  const context = await getSandboxContext(sandboxOptions);
  const { runtime } = context.sandbox;
  const autoArchiveInterval = "autoArchiveInterval" in runtime ? runtime.autoArchiveInterval : undefined;

  return {
    content:
      `Provider: ${context.provider === "e2b" ? "E2B" : "Daytona"}\n` +
      `Sandbox ID: ${context.sandbox.id}\n` +
      `Sandbox name: ${runtime.name ?? "(unnamed)"}\n` +
      `Snapshot: ${runtime.snapshot ?? "(unknown)"}\n` +
      `State: ${runtime.state ?? "(unknown)"}\n` +
      `Auto-archive interval: ${autoArchiveInterval ?? "(default)"}\n` +
      `Working directory: ${context.workDir}`,
    details: {
      provider: context.provider,
      sandboxId: context.sandbox.id,
      sandboxName: runtime.name ?? null,
      snapshot: runtime.snapshot ?? null,
      state: runtime.state ?? null,
      autoArchiveInterval: autoArchiveInterval ?? null,
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
