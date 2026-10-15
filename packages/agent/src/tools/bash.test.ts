import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  ensureRemoteParentDirectory: vi.fn(),
  executeSandboxCommand: vi.fn(),
  getSandboxContext: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock("../sandbox", () => ({ getSandboxContext: mocks.getSandboxContext }));
vi.mock("../sandbox/execute", async (importOriginal) => {
  const original = await importOriginal<typeof import("../sandbox/execute")>();
  return {
    ...original,
    ensureRemoteParentDirectory: mocks.ensureRemoteParentDirectory,
    executeSandboxCommand: mocks.executeSandboxCommand,
  };
});

import { createDaytonaBashTool } from "./bash";
import { createBackgroundProcessScope } from "./background-process-scope";
import { safeParse } from "../test/schema";

async function executeBash(input: {
  command: string;
  timeout?: number;
  isBackground?: boolean;
  env?: Record<string, string>;
}, options: { compactOutput?: boolean } = {}) {
  const bash = createDaytonaBashTool(
    { cacheKey: "bash-test" },
    createBackgroundProcessScope("bash-test-owner"),
    options,
  );
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
      sandbox: { id: "sandbox-bash", fs: { uploadFile: mocks.uploadFile } },
      workDir: "/workspace/repo",
    });
    mocks.executeSandboxCommand.mockResolvedValue({
      cwd: "/workspace/repo",
      sessionId: "autopr-bash-test-owner-session",
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

    const fullOutputPath = "/tmp/autopr-tool-output/autopr-session.log";
    expect(result.details.fullOutputPath).toBe(fullOutputPath);
    expect(result.content).toContain(`Full output: ${fullOutputPath} (2101 lines`);
    const [savedOutput, savedPath] = mocks.uploadFile.mock.calls[0]!;
    expect(savedPath).toBe(fullOutputPath);
    expect(Buffer.from(savedOutput).toString("utf8")).toContain("progress 0\n");
  });

  it("drops headers the model already sent in compact output", async () => {
    const result = await executeBash({ command: "pnpm test" }, { compactOutput: true });
    expect(result.content).toBe("Exit code: 0\n\ndone\n");

    const background = await executeBash({ command: "pnpm dev", isBackground: true }, { compactOutput: true });
    expect(background.content).toContain("Session ID: autopr-bash-test-owner-session");
    expect(background.content).toContain("Command ID: cmd-1");
  });

  it("does not save output that fits inline", async () => {
    const result = await executeBash({ command: "echo done" });
    expect(result.details.fullOutputPath).toBeNull();
    expect(result.content).not.toContain("Full output:");
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("does not impose the foreground timeout after a background launch", async () => {
    await executeBash({ command: "pnpm dev", isBackground: true });
    expect(mocks.executeSandboxCommand).toHaveBeenCalledWith("pnpm dev", expect.objectContaining({
      isBackground: true,
      sessionOwnerId: "bash-test-owner",
      timeout: undefined,
    }));
  });

  it("registers redacted background command metadata for the process tool", async () => {
    const backgroundProcesses = createBackgroundProcessScope("shared-test-owner");
    mocks.executeSandboxCommand.mockResolvedValue({
      cwd: "/workspace/repo",
      sessionId: "autopr-shared-test-owner-session",
      cmdId: "cmd-secret",
    });
    const bash = createDaytonaBashTool({ cacheKey: "bash-test" }, backgroundProcesses);
    if (!bash.execute) throw new Error("bash tool is not executable");

    await bash.execute({
      command: "node script.js",
      env: { API_TOKEN: "top-secret-value" },
      isBackground: true,
    }, { toolCallId: "bash-secret", messages: [] });

    expect(backgroundProcesses.getCommand(
      "autopr-shared-test-owner-session",
      "cmd-secret",
    )).toBe("node script.js");
  });

  it("never echoes environment override values into persisted tool output", async () => {
    mocks.executeSandboxCommand.mockResolvedValue({
      cwd: "/workspace/repo",
      sessionId: "autopr-bash-test-owner-session",
      cmdId: "cmd-secret-output",
      exitCode: 0,
      stdout: "API_TOKEN=top-secret-value\n",
      stderr: "failed with top-secret-value\n",
      output: "API_TOKEN=top-secret-value\nfailed with top-secret-value\n",
    });
    const result = await executeBash({
      command: "node script.js",
      env: { API_TOKEN: "top-secret-value" },
    });
    const serializedResult = JSON.stringify(result);
    expect(result.content).toContain("Environment overrides: API_TOKEN (values hidden)");
    expect(serializedResult).not.toContain("top-secret-value");
    expect(serializedResult).toContain("[REDACTED]");
  });

  it("bounds oversized command metadata as well as command output", async () => {
    const result = await executeBash({ command: `printf ${"x".repeat(10_000)}` });
    expect(result.details).toMatchObject({ commandTruncated: true });
    expect(String(result.details.command).length).toBeLessThan(4_100);
    expect(result.content.length).toBeLessThan(5_000);
  });

  it("rejects excessive timeout values in the input schema", () => {
    const bash = createDaytonaBashTool(
      { cacheKey: "bash-schema" },
      createBackgroundProcessScope("bash-schema-owner"),
    );
    expect(safeParse(bash.inputSchema, { command: "sleep 1", timeout: 3_601 }).success).toBe(false);
  });
});
