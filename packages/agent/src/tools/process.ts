import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { combineCommandOutput, toTextModelOutput, truncateText, truncateToolOutput } from "./format";
import { raceWithTimeout } from "./timeout";
import { requireString } from "./validation";
import type { BackgroundProcessScope } from "./background-process-scope";

const PROCESS_OPERATION_TIMEOUT_MS = 30_000;
const MAX_LISTED_SESSIONS = 25;
const MAX_LISTED_COMMANDS_PER_SESSION = 20;
const MAX_LIST_COMMAND_SUMMARY_CHARS = 1_000;
const MAX_COMMAND_SUMMARY_CHARS = 4_000;

const processInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
  }),
  z.object({
    action: z.literal("poll"),
    sessionId: z.string().max(256).optional().describe("Session ID returned by a background bash command."),
    commandId: z.string().max(256).optional().describe("Command ID returned by a background bash command."),
  }),
  z.object({
    action: z.literal("input"),
    sessionId: z.string().max(256).optional().describe("Session ID returned by a background bash command."),
    commandId: z.string().max(256).optional().describe("Command ID returned by a background bash command."),
    data: z.string().max(64 * 1024).optional().describe("Exact input to send. Include a newline when the process expects Enter."),
  }),
  z.object({
    action: z.literal("terminate"),
    sessionId: z.string().max(256).optional().describe("Session ID returned by a background bash command."),
  }),
]);

type ProcessInput = z.infer<typeof processInputSchema>;

function requireOwnedSessionId(
  value: string | undefined,
  backgroundProcesses: BackgroundProcessScope,
) {
  const sessionId = requireString(value, "sessionId", "process");
  if (!backgroundProcesses.ownsSession(sessionId)) {
    throw new Error("process can only access background sessions created by this agent run.");
  }
  return sessionId;
}

async function executeDaytonaProcess(
  input: ProcessInput,
  sandboxOptions: SandboxSessionOptions,
  backgroundProcesses: BackgroundProcessScope,
) {
  const { sandbox } = await getSandboxContext(sandboxOptions);

  if (input.action === "list") {
    const ownedSessions = (await runProcessOperation("list sessions", () => sandbox.process.listSessions()))
      .filter((session) => backgroundProcesses.ownsSession(session.sessionId));
    const sessions = ownedSessions
      .slice(0, MAX_LISTED_SESSIONS)
      .map((session) => ({
        sessionId: session.sessionId,
        commands: (session.commands ?? []).slice(0, MAX_LISTED_COMMANDS_PER_SESSION).map((command) => ({
          commandId: command.id,
          command: truncateText(
            backgroundProcesses.getCommand(session.sessionId, command.id) ?? "(command metadata unavailable)",
            MAX_LIST_COMMAND_SUMMARY_CHARS,
          ).text,
          exitCode: command.exitCode ?? null,
          status: command.exitCode === undefined ? "running" as const : "finished" as const,
        })),
        commandsTruncated: (session.commands?.length ?? 0) > MAX_LISTED_COMMANDS_PER_SESSION,
      }));
    const sessionsTruncated = ownedSessions.length > MAX_LISTED_SESSIONS;

    const listing = sessions.length > 0
      ? sessions.flatMap((session) => [
            `Session: ${session.sessionId}`,
            ...session.commands.map((command) =>
              `- ${command.commandId} [${command.status}${command.exitCode === null ? "" : `, exit ${command.exitCode}`}]: ${command.command}`),
            ...(session.commandsTruncated ? [`- [Showing first ${MAX_LISTED_COMMANDS_PER_SESSION} commands.]`] : []),
          ]).join("\n") + (sessionsTruncated ? `\n[Showing first ${MAX_LISTED_SESSIONS} sessions.]` : "")
      : "No background sessions from this agent run are active.";
    const listingPreview = truncateToolOutput(listing, { direction: "head" });

    return {
      content: listingPreview.text,
      details: {
        sessions,
        totalSessions: ownedSessions.length,
        sessionsTruncated,
        outputTruncated: listingPreview.truncated,
      },
    };
  }

  const sessionId = requireOwnedSessionId(input.sessionId, backgroundProcesses);

  if (input.action === "terminate") {
    await runProcessOperation(`terminate session ${sessionId}`, () => sandbox.process.deleteSession(sessionId));
    backgroundProcesses.forgetSession(sessionId);
    return {
      content: `Terminated background session ${sessionId}.`,
      details: { action: input.action, sessionId, terminated: true },
    };
  }

  const commandId = requireString(input.commandId, "commandId", "process");

  if (input.action === "input") {
    const data = requireString(input.data, "data", "process", { allowEmpty: true });
    await runProcessOperation(
      `send input to ${commandId}`,
      () => sandbox.process.sendSessionCommandInput(sessionId, commandId, data),
    );
    return {
      content: `Sent ${Buffer.byteLength(data, "utf8")} bytes to command ${commandId} in session ${sessionId}.`,
      details: { action: input.action, sessionId, commandId, bytesSent: Buffer.byteLength(data, "utf8") },
    };
  }

  const [command, logs] = await runProcessOperation(`poll command ${commandId}`, () => Promise.all([
    sandbox.process.getSessionCommand(sessionId, commandId),
    sandbox.process.getSessionCommandLogs(sessionId, commandId),
  ]));
  const redactedStdout = backgroundProcesses.redactOutput(sessionId, commandId, logs.stdout ?? "");
  const redactedStderr = backgroundProcesses.redactOutput(sessionId, commandId, logs.stderr ?? "");
  const combined = backgroundProcesses.redactOutput(
    sessionId,
    commandId,
    logs.output || combineCommandOutput(redactedStdout, redactedStderr),
  );
  const output = truncateToolOutput(combined, { direction: "tail" });
  const stdout = truncateToolOutput(redactedStdout, { direction: "tail" });
  const stderr = truncateToolOutput(redactedStderr, { direction: "tail" });
  const commandPreview = truncateText(
    backgroundProcesses.getCommand(sessionId, commandId) ?? "(command metadata unavailable)",
    MAX_COMMAND_SUMMARY_CHARS,
  );
  const status = command.exitCode === undefined ? "running" as const : "finished" as const;

  return {
    content:
      `Session ID: ${sessionId}\n` +
      `Command ID: ${commandId}\n` +
      `Status: ${status}\n` +
      `Exit code: ${command.exitCode ?? "pending"}\n\n` +
      (output.text || (status === "running" ? "(no output yet)" : "(no output)")),
    details: {
      action: input.action,
      sessionId,
      commandId,
      command: commandPreview.text,
      commandTruncated: commandPreview.truncated,
      status,
      exitCode: command.exitCode ?? null,
      stdout: stdout.text,
      stderr: stderr.text,
      output: output.text,
      outputStats: {
        totalBytes: output.totalBytes,
        totalLines: output.totalLines,
        outputBytes: output.outputBytes,
        outputLines: output.outputLines,
        truncatedBy: output.truncatedBy,
      },
      truncated: output.truncated,
    },
  };
}

function runProcessOperation<T>(label: string, operation: () => Promise<T>) {
  return raceWithTimeout(
    operation,
    PROCESS_OPERATION_TIMEOUT_MS,
    () => new Error(`Timed out while trying to ${label} in the sandbox.`),
  );
}

export function createSandboxProcessTool(
  sandboxOptions: SandboxSessionOptions,
  backgroundProcesses: BackgroundProcessScope,
) {
  return tool({
    title: "process",
    description:
      "Manage long-running commands started by bash with isBackground=true in the current agent run. Use list to discover this run's sessions, poll for tail-preserving bounded logs and exit status, input to send stdin, and terminate to clean up. Each sandbox operation has a bounded wait. Poll only when new output or completion is expected.",
    inputSchema: processInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaProcess(input, sandboxOptions, backgroundProcesses),
  });
}

export const createDaytonaProcessTool = createSandboxProcessTool;
