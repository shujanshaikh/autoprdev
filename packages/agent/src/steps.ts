import { getSandboxContext, type SandboxProvider, type SandboxSessionOptions } from "./sandbox";

export interface PreparedSandbox {
  provider: SandboxProvider;
  sandboxId: string;
  sandboxName?: string;
  snapshot?: string;
  workDir: string;
}

export async function prepareSandbox(options: SandboxSessionOptions): Promise<PreparedSandbox> {
  const context = await getSandboxContext(options);

  return {
    provider: context.provider,
    sandboxId: context.sandbox.id,
    sandboxName: context.sandbox.runtime.name,
    snapshot: context.sandbox.runtime.snapshot,
    workDir: context.workDir,
  };
}

export const prepareDaytonaSandbox = prepareSandbox;
