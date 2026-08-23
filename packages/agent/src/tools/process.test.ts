import { type JsonObject } from "@autopr/config/runtime-value";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSandboxContext: vi.fn(),
}));

import { createDaytonaProcessTool } from "./process";
import { createBackgroundProcessScope, type BackgroundProcessScope } from "./background-process-scope";

const OWNED_SESSION_ID = "autopr-process-test-owner-1";

type ProcessInput =
  | { action: "list" }
  | { action: "poll"; sessionId: string; commandId: string }
  | { action: "input"; sessionId: string; commandId: string; data: string }
  | { action: "terminate"; sessionId: string };

let backgroundProcesses: BackgroundProcessScope;

async function executeProcess(input: ProcessInput) {
  const processTool = createDaytonaProcessTool(
    { cacheKey: "process-test" },
    backgroundProcesses,
    { getSandboxContext: mocks.getSandboxContext },
  );
  if (!processTool.execute) throw new Error("Process tool is not executable");
  return /* SAFETY: This deliberately partial fixture implements exactly the owner-contract members exercised by this isolated test. */ await processTool.execute(input, { toolCallId: "process-call-1", messages: [] }) as {
    content: string;
    details: JsonObject;
  };
}

describe("Daytona process tool", () => {
  const process = {
    getSessionCommand: vi.fn(),
    getSessionCommandLogs: vi.fn(),
    sendSessionCommandInput: vi.fn(),
    listSessions: vi.fn(),
    deleteSession: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    backgroundProcesses = createBackgroundProcessScope("process-test-owner");
    mocks.getSandboxContext.mockResolvedValue({
      sandbox: { id: "sandbox-process-test", process },
      workDir: "/workspace/repo",
    });
  });

  it("lists only harness-owned background sessions", async () => {
    process.listSessions.mockResolvedValue([
      {
        sessionId: OWNED_SESSION_ID,
        commands: [{ id: "cmd-1", command: "pnpm dev", exitCode: undefined }],
      },
      {
        sessionId: "user-terminal",
        commands: [{ id: "cmd-private", command: "zsh", exitCode: undefined }],
      },
    ]);
    backgroundProcesses.registerCommand(OWNED_SESSION_ID, "cmd-1", "pnpm dev");

    const result = await executeProcess({ action: "list" });

    expect(result.content).toContain(OWNED_SESSION_ID);
    expect(result.content).toContain("cmd-1 [running]");
    expect(result.content).not.toContain("user-terminal");
  });

  it("bounds command metadata returned by session listings", async () => {
    process.listSessions.mockResolvedValue([{
      sessionId: OWNED_SESSION_ID,
      commands: [{ id: "cmd-large", command: "x".repeat(10_000), exitCode: undefined }],
    }]);
    backgroundProcesses.registerCommand(OWNED_SESSION_ID, "cmd-large", "x".repeat(10_000));

    const result = await executeProcess({ action: "list" });
    const sessions = /* SAFETY: This deliberately partial fixture implements exactly the owner-contract members exercised by this isolated test. */ result.details.sessions as Array<{ commands: Array<{ command: string }> }>;
    expect(sessions[0]?.commands[0]?.command.length).toBeLessThan(4_100);
    expect(result.content.length).toBeLessThan(5_000);
  });

  it("polls command status and combines logs", async () => {
    process.getSessionCommand.mockResolvedValue({
      id: "cmd-1",
      command: "cd '/workspace/repo' && export API_TOKEN='top-secret-value'; pnpm test",
      exitCode: 0,
    });
    backgroundProcesses.registerCommand(OWNED_SESSION_ID, "cmd-1", "pnpm test");
    process.getSessionCommandLogs.mockResolvedValue({
      stdout: "tests passed\n",
      stderr: "one warning\n",
    });

    const result = await executeProcess({
      action: "poll",
      sessionId: OWNED_SESSION_ID,
      commandId: "cmd-1",
    });

    expect(result.content).toContain("Status: finished");
    expect(result.content).toContain("Exit code: 0");
    expect(result.content).toContain("tests passed\none warning");
    expect(JSON.stringify(result)).not.toContain("top-secret-value");
    expect(process.getSessionCommand).toHaveBeenCalledWith(OWNED_SESSION_ID, "cmd-1");
  });

  it("keeps the latest diagnostics when background logs are oversized", async () => {
    process.getSessionCommand.mockResolvedValue({
      id: "cmd-1",
      command: "pnpm test",
      exitCode: 1,
    });
    backgroundProcesses.registerCommand(OWNED_SESSION_ID, "cmd-1", "pnpm test");
    process.getSessionCommandLogs.mockResolvedValue({
      stdout: `${Array.from({ length: 2_100 }, (_, index) => `progress ${index}`).join("\n")}\nFAIL final diagnostic`,
      stderr: "",
    });

    const result = await executeProcess({
      action: "poll",
      sessionId: OWNED_SESSION_ID,
      commandId: "cmd-1",
    });

    expect(result.content).toContain("FAIL final diagnostic");
    expect(result.content).toContain("showing tail");
    expect(result.details).toMatchObject({
      truncated: true,
      outputStats: { truncatedBy: "lines" },
    });
  });

  it("sends input and terminates an owned session", async () => {
    await executeProcess({
      action: "input",
      sessionId: OWNED_SESSION_ID,
      commandId: "cmd-1",
      data: "yes\n",
    });
    await executeProcess({ action: "terminate", sessionId: OWNED_SESSION_ID });

    expect(process.sendSessionCommandInput).toHaveBeenCalledWith(OWNED_SESSION_ID, "cmd-1", "yes\n");
    expect(process.deleteSession).toHaveBeenCalledWith(OWNED_SESSION_ID);
  });

  it("refuses access to sessions created by another agent run", async () => {
    await expect(executeProcess({
      action: "poll",
      sessionId: "autopr-another-owner-1",
      commandId: "cmd-private",
    })).rejects.toThrow("only access background sessions created by this agent run");

    expect(process.getSessionCommand).not.toHaveBeenCalled();
  });

  it("never exposes environment values stored in Daytona command metadata", async () => {
    process.listSessions.mockResolvedValue([{
      sessionId: OWNED_SESSION_ID,
      commands: [{
        id: "cmd-secret",
        command: "cd '/workspace/repo' && export API_TOKEN='top-secret-value'; pnpm dev",
        exitCode: undefined,
      }],
    }]);
    backgroundProcesses.registerCommand(OWNED_SESSION_ID, "cmd-secret", "pnpm dev");

    const result = await executeProcess({ action: "list" });
    const serializedResult = JSON.stringify(result);

    expect(serializedResult).toContain("pnpm dev");
    expect(serializedResult).not.toContain("top-secret-value");
    expect(serializedResult).not.toContain("export API_TOKEN");
  });

  it("redacts environment values echoed by background process logs", async () => {
    process.getSessionCommand.mockResolvedValue({
      id: "cmd-secret",
      command: "cd '/workspace/repo' && export API_TOKEN='top-secret-value'; pnpm dev",
      exitCode: undefined,
    });
    process.getSessionCommandLogs.mockResolvedValue({
      stdout: "token=top-secret-value\n",
      stderr: "retrying top-secret-value\n",
    });
    backgroundProcesses.registerCommand(
      OWNED_SESSION_ID,
      "cmd-secret",
      "pnpm dev",
      { API_TOKEN: "top-secret-value" },
    );

    const result = await executeProcess({
      action: "poll",
      sessionId: OWNED_SESSION_ID,
      commandId: "cmd-secret",
    });

    expect(JSON.stringify(result)).not.toContain("top-secret-value");
    expect(result.content).toContain("[REDACTED]");
  });
});
