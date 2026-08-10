import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { executeSandboxCommand, resolveSandboxPath } from "../sandbox/execute";
import { combineCommandOutput, toTextModelOutput, truncateText, truncateToolOutput } from "./format";
import { requireString } from "./validation";

const DEFAULT_BASH_TIMEOUT_SECONDS = 120;
const MAX_BASH_TIMEOUT_SECONDS = 3_600;
const MAX_COMMAND_SUMMARY_CHARS = 4_000;
const bashEnvironmentSchema = z
  .record(
    z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Invalid environment variable name."),
    z.string().max(32 * 1024),
  )
  .refine(
    (environment) => Object.keys(environment).length <= 64,
    "At most 64 environment overrides are allowed.",
  )
  .refine(
    (environment) => Object.entries(environment)
      .reduce((bytes, [name, value]) => bytes + Buffer.byteLength(name) + Buffer.byteLength(value), 0) <= 64 * 1024,
    "Environment overrides must total at most 64 KiB.",
  );

const bashInputSchema = z.object({
  command: z.string().max(100_000).optional().describe("Required. Shell command to execute inside the Daytona sandbox."),
  cwd: z.string().max(4_096).optional().describe("Working directory in the sandbox. Relative paths resolve from the sandbox workdir."),
  timeout: z.number().int().min(1).max(MAX_BASH_TIMEOUT_SECONDS).optional().describe(
    `Foreground timeout in seconds. Defaults to ${DEFAULT_BASH_TIMEOUT_SECONDS}; maximum ${MAX_BASH_TIMEOUT_SECONDS}. Ignored after a background command starts.`,
  ),
  env: bashEnvironmentSchema.optional().describe("Extra environment variables to set for the command. Values are never echoed in tool output."),
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
    timeout: input.isBackground ? input.timeout : input.timeout ?? DEFAULT_BASH_TIMEOUT_SECONDS,
    env: input.env,
    isBackground: input.isBackground,
    sandboxOptions,
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const output = result.output ?? "";
  const combined = output || combineCommandOutput(stdout, stderr);
  const truncatedOutput = truncateToolOutput(combined, { direction: "tail" });
  const stdoutPreview = truncateToolOutput(stdout, { direction: "tail" });
  const stderrPreview = truncateToolOutput(stderr, { direction: "tail" });
  const commandPreview = truncateText(command, MAX_COMMAND_SUMMARY_CHARS);
  const isBackground = Boolean(input.isBackground);
  const timedOut = Boolean(result.timedOut);
  const backgroundLaunchFailed = isBackground && typeof result.exitCode === "number" && result.exitCode !== 0;
  const timeoutSummary = result.timeout
    ? `Command timed out after ${result.timeout} second${result.timeout === 1 ? "" : "s"}.`
    : "Daytona timed out while waiting for the command to finish.";

  const envNames = Object.keys(input.env ?? {});

  return {
    content:
      `Command: ${commandPreview.text}\n` +
      (envNames.length > 0 ? `Environment overrides: ${envNames.join(", ")} (values hidden)\n` : "") +
      `Working directory: ${result.cwd}\n` +
      `Background: ${isBackground ? "yes" : "no"}\n` +
      `Session ID: ${result.sessionId}\n` +
      `Command ID: ${result.cmdId ?? "unknown"}\n` +
      `Timed out: ${timedOut ? "yes" : "no"}\n` +
      `Exit code: ${isBackground && !backgroundLaunchFailed ? "pending" : result.exitCode ?? "unknown"}\n\n` +
      `${truncatedOutput.text || (timedOut ? timeoutSummary : isBackground ? "Command started in background." : "(no output)")}`,
    details: {
      command: commandPreview.text,
      commandTruncated: commandPreview.truncated,
      cwd: result.cwd,
      sessionId: result.sessionId,
      cmdId: result.cmdId ?? null,
      isBackground,
      exitCode: result.exitCode ?? null,
      stdout: stdoutPreview.text,
      stderr: stderrPreview.text,
      output: truncatedOutput.text,
      outputStats: {
        totalBytes: truncatedOutput.totalBytes,
        totalLines: truncatedOutput.totalLines,
        outputBytes: truncatedOutput.outputBytes,
        outputLines: truncatedOutput.outputLines,
        truncatedBy: truncatedOutput.truncatedBy,
      },
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
      "Run shell commands inside Daytona with a 120-second default foreground timeout and tail-preserving bounded output. Use for package scripts, tests, type checks, installs, and Git inspection. Commands mutate state when the command does; use isBackground=true for servers/watchers and manage them with process. Environment values are never echoed. Do not retry a failed command unchanged without using the final diagnostic.",
    inputSchema: bashInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaBash(input, sandboxOptions),
  });
}
