import { getSandboxContext, type SandboxSessionOptions } from "./sandbox";

export interface PreparedSandbox {
  sandboxId: string;
  sandboxName?: string;
  snapshot?: string;
  workDir: string;
}

export async function prepareDaytonaSandbox(options: SandboxSessionOptions): Promise<PreparedSandbox> {
  "use step";

  const context = await getSandboxContext(options);

  return {
    sandboxId: context.sandbox.id,
    sandboxName: context.sandbox.name,
    snapshot: context.sandbox.snapshot,
    workDir: context.workDir,
  };
}
