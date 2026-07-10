import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { executeSandboxCommand, prependEnvExports, resolveSandboxPath } from "../sandbox/execute";
import { combineCommandOutput, MAX_COMMAND_OUTPUT_CHARS, toTextModelOutput, truncateText } from "./format";
import { requireString } from "./validation";

const bashInputSchema = z.object({
  command: z.string().optional().describe("Required. Shell command to execute inside the Daytona sandbox."),
  cwd: z.string().optional().describe("Working directory in the sandbox. Relative paths resolve from the sandbox workdir."),
  timeout: z.number().min(1).optional().describe("Timeout in seconds."),
  env: z.record(z.string(), z.string()).optional().describe("Extra environment variables to set for the command."),
  isBackground: z
    .boolean()
    .optional()
    .describe(
      "Use true for long-running commands such as dev servers, preview servers, watchers, and tail -f. Starts the command asynchronously in a persistent Daytona session and returns immediately with session and command metadata.",
    ),
});

type BashInput = z.infer<typeof bashInputSchema>;

async function executeDaytonaBash(input: BashInput, sandboxOptions: SandboxSessionOptions) {
  const command = requireString(input.command, "command", "bash");
  const context = await getSandboxContext(sandboxOptions);
  const result = await executeSandboxCommand(command, {
    cwd: resolveSandboxPath(input.cwd, context.workDir),
    timeout: input.timeout,
    env: input.env,
    isBackground: input.isBackground,
    sandboxOptions,
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const output = result.output ?? "";
  const combined = combineCommandOutput(stdout, stderr) || output;
  const truncatedOutput = truncateText(combined, MAX_COMMAND_OUTPUT_CHARS);
  const isBackground = Boolean(input.isBackground);
  const timedOut = Boolean(result.timedOut);
  const backgroundLaunchFailed = isBackground && typeof result.exitCode === "number" && result.exitCode !== 0;
  const timeoutSummary = result.timeout
    ? `Command timed out after ${result.timeout} second${result.timeout === 1 ? "" : "s"}.`
    : "Daytona timed out while waiting for the command to finish.";

  return {
    content:
      `Command: ${prependEnvExports(command, input.env)}\n` +
      `Working directory: ${result.cwd}\n` +
      `Background: ${isBackground ? "yes" : "no"}\n` +
      `Session ID: ${result.sessionId}\n` +
      `Command ID: ${result.cmdId ?? "unknown"}\n` +
      `Timed out: ${timedOut ? "yes" : "no"}\n` +
      `Exit code: ${isBackground && !backgroundLaunchFailed ? "pending" : result.exitCode ?? "unknown"}\n\n` +
      `${truncatedOutput.text || (timedOut ? timeoutSummary : isBackground ? "Command started in background." : "(no output)")}`,
    details: {
      command,
      cwd: result.cwd,
      sessionId: result.sessionId,
      cmdId: result.cmdId ?? null,
      isBackground,
      exitCode: result.exitCode ?? null,
      stdout,
      stderr,
      output,
      timedOut,
      timeout: result.timeout ?? null,
      truncated: truncatedOutput.truncated,
    },
  };
}

export function createDaytonaBashTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "bash",
    description:
      "Run shell commands inside the Daytona sandbox. Use for package manager commands, tests, type checks, scripts, installs, git inspection, and operations better handled by a shell. Commands mutate state when the command does; use isBackground=true for dev servers, watchers, previews, and tailing logs. Do not retry a failed command unchanged without using the error output.",
    inputSchema: bashInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaBash(input, sandboxOptions),
  });
}
