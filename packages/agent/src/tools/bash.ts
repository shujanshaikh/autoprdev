import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { executeSandboxCommand, prependEnvExports, resolveSandboxPath } from "../sandbox/execute";
import { combineCommandOutput, MAX_COMMAND_OUTPUT_CHARS, toTextModelOutput, truncateText } from "./format";

const bashInputSchema = z.object({
  command: z.string().describe("Shell command to execute inside the Daytona sandbox."),
  cwd: z.string().optional().describe("Working directory in the sandbox. Relative paths resolve from the sandbox workdir."),
  timeout: z.number().min(1).optional().describe("Timeout in seconds."),
  env: z.record(z.string(), z.string()).optional().describe("Extra environment variables to set for the command."),
  isBackground: z
    .boolean()
    .optional()
    .describe("If true, starts the command asynchronously in a persistent sandbox session and returns immediately."),
});

type BashInput = z.infer<typeof bashInputSchema>;

async function executeDaytonaBash(input: BashInput, sandboxOptions: SandboxSessionOptions) {
  "use step";

  const context = await getSandboxContext(sandboxOptions);
  const result = await executeSandboxCommand(input.command, {
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

  return {
    content:
      `Command: ${prependEnvExports(input.command, input.env)}\n` +
      `Working directory: ${result.cwd}\n` +
      `Background: ${isBackground ? "yes" : "no"}\n` +
      `Session ID: ${result.sessionId}\n` +
      `Command ID: ${result.cmdId}\n` +
      `Exit code: ${isBackground ? "pending" : result.exitCode ?? "unknown"}\n\n` +
      `${truncatedOutput.text || (isBackground ? "Command started in background." : "(no output)")}`,
    details: {
      command: input.command,
      cwd: result.cwd,
      sessionId: result.sessionId,
      cmdId: result.cmdId,
      isBackground,
      exitCode: result.exitCode ?? null,
      stdout,
      stderr,
      output,
      truncated: truncatedOutput.truncated,
    },
  };
}

export function createDaytonaBashTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "bash",
    description: "Run shell commands inside the Daytona sandbox.",
    inputSchema: bashInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaBash(input, sandboxOptions),
  });
}
