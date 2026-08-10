import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { combineCommandOutput, MAX_COMMAND_OUTPUT_CHARS, toTextModelOutput, truncateText } from "./format";
import { requireString } from "./validation";

const OWNED_SESSION_PREFIX = "autopr-";

const processInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
  }),
  z.object({
    action: z.literal("poll"),
    sessionId: z.string().optional().describe("Session ID returned by a background bash command."),
    commandId: z.string().optional().describe("Command ID returned by a background bash command."),
  }),
  z.object({
    action: z.literal("input"),
    sessionId: z.string().optional().describe("Session ID returned by a background bash command."),
    commandId: z.string().optional().describe("Command ID returned by a background bash command."),
    data: z.string().optional().describe("Exact input to send. Include a newline when the process expects Enter."),
  }),
  z.object({
    action: z.literal("terminate"),
    sessionId: z.string().optional().describe("Session ID returned by a background bash command."),
  }),
]);

type ProcessInput = z.infer<typeof processInputSchema>;

function requireOwnedSessionId(value: string | undefined) {
  const sessionId = requireString(value, "sessionId", "process");
  if (!sessionId.startsWith(OWNED_SESSION_PREFIX)) {
    throw new Error("process can only access background sessions created by AutoPR bash commands.");
  }
  return sessionId;
}

async function executeDaytonaProcess(input: ProcessInput, sandboxOptions: SandboxSessionOptions) {
  const { sandbox } = await getSandboxContext(sandboxOptions);

  if (input.action === "list") {
    const sessions = (await sandbox.process.listSessions())
      .filter((session) => session.sessionId.startsWith(OWNED_SESSION_PREFIX))
      .map((session) => ({
        sessionId: session.sessionId,
        commands: (session.commands ?? []).map((command) => ({
          commandId: command.id,
          command: command.command,
          exitCode: command.exitCode ?? null,
          status: command.exitCode === undefined ? "running" as const : "finished" as const,
        })),
      }));

    return {
      content: sessions.length > 0
        ? sessions.flatMap((session) => [
            `Session: ${session.sessionId}`,
            ...session.commands.map((command) =>
              `- ${command.commandId} [${command.status}${command.exitCode === null ? "" : `, exit ${command.exitCode}`}]: ${command.command}`),
          ]).join("\n")
        : "No AutoPR background sessions are active.",
      details: { sessions },
    };
  }

  const sessionId = requireOwnedSessionId(input.sessionId);

  if (input.action === "terminate") {
    await sandbox.process.deleteSession(sessionId);
    return {
      content: `Terminated background session ${sessionId}.`,
      details: { action: input.action, sessionId, terminated: true },
    };
  }

  const commandId = requireString(input.commandId, "commandId", "process");

  if (input.action === "input") {
    const data = requireString(input.data, "data", "process", { allowEmpty: true });
    await sandbox.process.sendSessionCommandInput(sessionId, commandId, data);
    return {
      content: `Sent ${Buffer.byteLength(data, "utf8")} bytes to command ${commandId} in session ${sessionId}.`,
      details: { action: input.action, sessionId, commandId, bytesSent: Buffer.byteLength(data, "utf8") },
    };
  }

  const [command, logs] = await Promise.all([
    sandbox.process.getSessionCommand(sessionId, commandId),
    sandbox.process.getSessionCommandLogs(sessionId, commandId),
  ]);
  const combined = combineCommandOutput(logs.stdout, logs.stderr) || logs.output || "";
  const output = truncateText(combined, MAX_COMMAND_OUTPUT_CHARS);
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
      command: command.command,
      status,
      exitCode: command.exitCode ?? null,
      stdout: logs.stdout ?? "",
      stderr: logs.stderr ?? "",
      output: logs.output ?? "",
      truncated: output.truncated,
    },
  };
}

export function createDaytonaProcessTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "process",
    description:
      "Manage long-running commands started by bash with isBackground=true. Use list to discover AutoPR sessions, poll to read current logs and exit status, input to send stdin, and terminate to stop and clean up a session. Poll only when new output or process completion is expected; do not poll repeatedly without doing other useful work.",
    inputSchema: processInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaProcess(input, sandboxOptions),
  });
}
