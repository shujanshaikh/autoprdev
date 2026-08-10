import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeSandboxCommand: vi.fn(),
  getSandboxContext: vi.fn(),
}));

vi.mock("../sandbox", () => ({ getSandboxContext: mocks.getSandboxContext }));
vi.mock("../sandbox/execute", async (importOriginal) => {
  const original = await importOriginal<typeof import("../sandbox/execute")>();
  return { ...original, executeSandboxCommand: mocks.executeSandboxCommand };
});

import { createDaytonaBashTool } from "./bash";

function safeParse(schema: unknown, value: unknown): { success: boolean } {
  return (schema as { safeParse(input: unknown): { success: boolean } }).safeParse(value);
}

async function executeBash(input: {
  command: string;
  timeout?: number;
  isBackground?: boolean;
  env?: Record<string, string>;
}) {
  const bash = createDaytonaBashTool({ cacheKey: "bash-test" });
  if (!bash.execute) throw new Error("bash tool is not executable");
  return await bash.execute(input, { toolCallId: "bash-1", messages: [] }) as {
    content: string;
    details: Record<string, unknown>;
  };
}

describe("Daytona bash tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSandboxContext.mockResolvedValue({
      sandbox: { id: "sandbox-bash" },
      workDir: "/workspace/repo",
    });
    mocks.executeSandboxCommand.mockResolvedValue({
      cwd: "/workspace/repo",
      sessionId: "autopr-session",
      cmdId: "cmd-1",
      exitCode: 0,
      stdout: "done\n",
    });
  });

  it("applies a bounded default timeout to foreground commands", async () => {
    await executeBash({ command: "pnpm test" });
    expect(mocks.executeSandboxCommand).toHaveBeenCalledWith("pnpm test", expect.objectContaining({ timeout: 120 }));
  });

  it("keeps the final diagnostic and bounds persisted output previews", async () => {
    mocks.executeSandboxCommand.mockResolvedValue({
      cwd: "/workspace/repo",
      sessionId: "autopr-session",
      cmdId: "cmd-1",
      exitCode: 1,
      stdout: `${Array.from({ length: 2_100 }, (_, index) => `progress ${index}`).join("\n")}\nFAIL final diagnostic`,
      stderr: "",
    });

    const result = await executeBash({ command: "pnpm test" });
    expect(result.content).toContain("FAIL final diagnostic");
    expect(result.content).toContain("showing tail");
    expect(result.content).not.toContain("progress 0\n");
    expect(result.details).toMatchObject({
      truncated: true,
      outputStats: { truncatedBy: "lines" },
    });
    expect(String(result.details.stdout).length).toBeLessThan(60_000);
  });

  it("does not impose the foreground timeout after a background launch", async () => {
    await executeBash({ command: "pnpm dev", isBackground: true });
    expect(mocks.executeSandboxCommand).toHaveBeenCalledWith("pnpm dev", expect.objectContaining({
      isBackground: true,
      timeout: undefined,
    }));
  });

  it("never echoes environment override values into persisted tool output", async () => {
    const result = await executeBash({
      command: "node script.js",
      env: { API_TOKEN: "top-secret-value" },
    });
    expect(result.content).toContain("Environment overrides: API_TOKEN (values hidden)");
    expect(result.content).not.toContain("top-secret-value");
  });

  it("bounds oversized command metadata as well as command output", async () => {
    const result = await executeBash({ command: `printf ${"x".repeat(10_000)}` });
    expect(result.details).toMatchObject({ commandTruncated: true });
    expect(String(result.details.command).length).toBeLessThan(4_100);
    expect(result.content.length).toBeLessThan(5_000);
  });

  it("rejects excessive timeout values in the input schema", () => {
    const bash = createDaytonaBashTool({ cacheKey: "bash-schema" });
    expect(safeParse(bash.inputSchema, { command: "sleep 1", timeout: 3_601 }).success).toBe(false);
  });
});
