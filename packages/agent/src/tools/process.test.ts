import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DaytonaSandbox } from "../sandbox";

const mocks = vi.hoisted(() => ({
  getSandboxContext: vi.fn(),
}));

vi.mock("../sandbox", () => ({
  getSandboxContext: mocks.getSandboxContext,
}));

import { createDaytonaProcessTool } from "./process";

type ProcessInput =
  | { action: "list" }
  | { action: "poll"; sessionId: string; commandId: string }
  | { action: "input"; sessionId: string; commandId: string; data: string }
  | { action: "terminate"; sessionId: string };

async function executeProcess(input: ProcessInput) {
  const processTool = createDaytonaProcessTool({ cacheKey: "process-test" });
  if (!processTool.execute) throw new Error("Process tool is not executable");
  return await processTool.execute(input, { toolCallId: "process-call-1", messages: [] }) as {
    content: string;
    details: Record<string, unknown>;
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
    mocks.getSandboxContext.mockResolvedValue({
      sandbox: { id: "sandbox-process-test", process } as unknown as DaytonaSandbox,
      workDir: "/workspace/repo",
    });
  });

  it("lists only harness-owned background sessions", async () => {
    process.listSessions.mockResolvedValue([
      {
        sessionId: "autopr-1",
        commands: [{ id: "cmd-1", command: "pnpm dev", exitCode: undefined }],
      },
      {
        sessionId: "user-terminal",
        commands: [{ id: "cmd-private", command: "zsh", exitCode: undefined }],
      },
    ]);

    const result = await executeProcess({ action: "list" });

    expect(result.content).toContain("autopr-1");
    expect(result.content).toContain("cmd-1 [running]");
    expect(result.content).not.toContain("user-terminal");
  });

  it("polls command status and combines logs", async () => {
    process.getSessionCommand.mockResolvedValue({
      id: "cmd-1",
      command: "pnpm test",
      exitCode: 0,
    });
    process.getSessionCommandLogs.mockResolvedValue({
      stdout: "tests passed\n",
      stderr: "one warning\n",
    });

    const result = await executeProcess({
      action: "poll",
      sessionId: "autopr-1",
      commandId: "cmd-1",
    });

    expect(result.content).toContain("Status: finished");
    expect(result.content).toContain("Exit code: 0");
    expect(result.content).toContain("tests passed\none warning");
    expect(process.getSessionCommand).toHaveBeenCalledWith("autopr-1", "cmd-1");
  });

  it("sends input and terminates an owned session", async () => {
    await executeProcess({
      action: "input",
      sessionId: "autopr-1",
      commandId: "cmd-1",
      data: "yes\n",
    });
    await executeProcess({ action: "terminate", sessionId: "autopr-1" });

    expect(process.sendSessionCommandInput).toHaveBeenCalledWith("autopr-1", "cmd-1", "yes\n");
    expect(process.deleteSession).toHaveBeenCalledWith("autopr-1");
  });

  it("refuses access to sessions not created by harness bash calls", async () => {
    await expect(executeProcess({
      action: "poll",
      sessionId: "user-terminal",
      commandId: "cmd-private",
    })).rejects.toThrow("only access background sessions created by AutoPR");

    expect(process.getSessionCommand).not.toHaveBeenCalled();
  });
});
