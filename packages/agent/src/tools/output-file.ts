import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { ensureRemoteParentDirectory } from "../sandbox/execute";

/** Sandbox directory for tool output too large to inline. The read tool may open files here. */
export const TOOL_OUTPUT_DIR = "/tmp/autopr-tool-output";

/**
 * Saves the full text of a truncated tool result inside the sandbox so the
 * agent can page or search it instead of re-running the command. Returns the
 * file path, or undefined when the sandbox write fails.
 */
export async function saveToolOutputFile(
  text: string,
  name: string,
  sandboxOptions: SandboxSessionOptions,
): Promise<string | undefined> {
  const path = `${TOOL_OUTPUT_DIR}/${name.replace(/[^A-Za-z0-9_.-]/g, "-")}.log`;

  try {
    await ensureRemoteParentDirectory(path, sandboxOptions);
    const { sandbox } = await getSandboxContext(sandboxOptions);
    await sandbox.fs.uploadFile(Buffer.from(text, "utf8"), path);
    return path;
  } catch (error) {
    console.warn("Could not save full tool output to the sandbox.", error);
    return undefined;
  }
}
