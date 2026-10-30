import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  executeSandboxCommand: vi.fn(),
  getSandboxContext: vi.fn(),
  write: vi.fn(),
}));

vi.mock("../sandbox", () => ({ getSandboxContext: mocks.getSandboxContext }));
vi.mock("../sandbox/execute", async (importOriginal) => {
  const original = await importOriginal<typeof import("../sandbox/execute")>();
  return { ...original, executeSandboxCommand: mocks.executeSandboxCommand };
});

import { saveToolOutputFile } from "./output-file";

describe("saveToolOutputFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeSandboxCommand.mockResolvedValue({ cwd: "/", sessionId: "s", exitCode: 0 });
    mocks.getSandboxContext.mockResolvedValue({ sandbox: { files: { write: mocks.write } }, workDir: "/w" });
  });

  it("prunes old outputs to a fixed count before saving the new one", async () => {
    await expect(saveToolOutputFile("full output", "autopr/session 1", { cacheKey: "t" }))
      .resolves.toBe("/tmp/autopr-tool-output/autopr-session-1.log");

    expect(mocks.executeSandboxCommand.mock.calls[0]![0]).toBe(
      "mkdir -p '/tmp/autopr-tool-output' && cd '/tmp/autopr-tool-output' && ls -1t | tail -n +20 | xargs -r rm -f --",
    );
    const [path, saved] = mocks.write.mock.calls[0]!;
    expect(saved).toBe("full output");
    expect(path).toBe("/tmp/autopr-tool-output/autopr-session-1.log");
  });

  it("returns undefined instead of failing the tool when the sandbox write fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.executeSandboxCommand.mockResolvedValue({ cwd: "/", sessionId: "s", exitCode: 1, stderr: "disk full" });

    await expect(saveToolOutputFile("x", "s", { cacheKey: "t" })).resolves.toBeUndefined();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
