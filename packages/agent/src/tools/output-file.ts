import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { executeSandboxCommand, shellQuote } from "../sandbox/execute";

/** Sandbox directory for tool output too large to inline. The read tool may open files here. */
export const TOOL_OUTPUT_DIR = "/tmp/autopr-tool-output";

/** Saved outputs kept per sandbox, including the newest one. */
export const MAX_TOOL_OUTPUT_FILES = 20;

/**
 * Saves the full text of a truncated tool result inside the sandbox so the
 * agent can page or search it instead of re-running the command. Older files
 * beyond the newest MAX_TOOL_OUTPUT_FILES are removed. Returns the file path,
 * or undefined when the sandbox write fails.
 */
export async function saveToolOutputFile(
  text: string,
  name: string,
  sandboxOptions: SandboxSessionOptions,
): Promise<string | undefined> {
  const path = `${TOOL_OUTPUT_DIR}/${name.replace(/[^A-Za-z0-9_.-]/g, "-")}.log`;
  const directory = shellQuote(TOOL_OUTPUT_DIR);

  try {
    // File names are sanitized above, so `ls` output is safe to pass to rm.
    const prepared = await executeSandboxCommand(
      `mkdir -p ${directory} && cd ${directory} && ls -1t | tail -n +${MAX_TOOL_OUTPUT_FILES} | xargs -r rm -f --`,
      { cwd: "/", timeout: 30, sandboxOptions },
    );
    if (prepared.exitCode !== 0) {
      throw new Error(prepared.stderr || prepared.output || "Could not prepare the tool output directory.");
    }
    const { sandbox } = await getSandboxContext(sandboxOptions);
    await sandbox.fs.uploadFile(Buffer.from(text, "utf8"), path);
    return path;
  } catch (error) {
    console.warn("Could not save full tool output to the sandbox.", error);
    return undefined;
  }
}
