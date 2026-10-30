import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import type { ExecInput } from "@opencoredev/sandbox-sdk/provider";

const mocks = vi.hoisted(() => ({
  createRuntime: vi.fn(),
  deleteRuntime: vi.fn(),
  exec: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("./e2b", async (original) => ({
  ...await original<typeof import("./e2b")>(),
  createE2BSandbox: mocks.createRuntime,
  deleteE2BSandbox: mocks.deleteRuntime,
}));
vi.mock("@opencoredev/sandbox-sdk/e2b", () => ({
  e2b: () => ({
    name: "e2b",
    capabilities: new Set(),
    connect: mocks.connect,
    native: () => ({}),
    exec: mocks.exec,
    files: { writeCreatesParents: true },
  }),
}));

import { createSandbox } from "./index";
import { E2BSandboxRuntime } from "./e2b";

describe("Sandbox SDK integration", () => {
  const sdk = {
    sandboxId: "sdk-integration",
    files: {
      read: vi.fn(),
      write: vi.fn(),
      makeDir: vi.fn(),
    },
    setTimeout: vi.fn(),
  };
  let sandbox: Awaited<ReturnType<typeof createSandbox>> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.createRuntime.mockResolvedValue(new E2BSandboxRuntime(sdk as never));
    mocks.connect.mockResolvedValue({
      id: sdk.sandboxId, state: "running", labels: {}, createdAt: Date.now(),
    });
    sdk.files.read.mockResolvedValue('{"TOKEN":"project-token"}');
    mocks.exec.mockImplementation(async (_id: string, input: ExecInput) => {
      input.onChunk({ stream: "stdout", text: "hello" });
      return { exitCode: 0, timedOut: false };
    });
  });

  afterEach(async () => {
    await sandbox?.close();
    sandbox = undefined;
  });

  it("uses the package's command API while retaining the E2B user and current environment", async () => {
    sandbox = await createSandbox({ provider: "e2b", sandboxId: sdk.sandboxId });
    const command = "printf '%s' \"$TOKEN\"";
    await expect(sandbox.run(command, { cwd: "/home/autopr/repo", env: { TOKEN: "override" } }))
      .resolves.toMatchObject({ ok: true, stdout: "hello", exitCode: 0 });
    const input = mocks.exec.mock.calls[0]![1] as ExecInput;
    expect(input).toMatchObject({ cwd: "/home/autopr/repo", env: { TOKEN: "override" } });
    // Parse the generated shell without running runuser or contacting a sandbox.
    const parsed = spawnSync("bash", ["-c", 'eval "set -- $AUTOPR_TEST_COMMAND"; eval "set -- $7"; printf "%s" "$5"'], {
      encoding: "utf8", env: { ...process.env, AUTOPR_TEST_COMMAND: input.command },
    });
    expect(parsed.status).toBe(0);
    expect(parsed.stdout).toBe(command);
    expect(input.command).toMatch(/^runuser -u e2b -- bash -lc /);
    expect(sdk.setTimeout).toHaveBeenCalledWith(900_000);

    sdk.files.read.mockResolvedValue('{"TOKEN":"rotated-token"}');
    await sandbox.run("echo ok", { cwd: "/home/autopr/repo" });
    expect(mocks.exec.mock.calls[1]![1].env.TOKEN).toBe("${e2b.secrets.rotated-token}");
  });

  it("cleans up a newly provisioned sandbox when SDK attachment fails", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("connection failed"));
    await expect(createSandbox({ provider: "e2b" })).rejects.toThrow("connection failed");
    expect(mocks.deleteRuntime).toHaveBeenCalledWith(sdk.sandboxId);
  });

  it("leaves an existing sandbox intact when SDK attachment fails", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("connection failed"));
    await expect(createSandbox({ provider: "e2b", sandboxId: sdk.sandboxId })).rejects.toThrow("connection failed");
    expect(mocks.deleteRuntime).not.toHaveBeenCalled();
  });

  it("writes binary files through the native user without changing their bytes", async () => {
    sandbox = await createSandbox({ provider: "e2b", sandboxId: sdk.sandboxId });
    const bytes = new Uint8Array([0, 255, 10, 128]);
    await sandbox.files.write("/home/autopr/repo/asset.bin", bytes);
    const [path, data] = sdk.files.write.mock.calls[0]!;
    expect(path).toBe("/home/autopr/repo/asset.bin");
    expect(new Uint8Array(data)).toEqual(bytes);
  });

  it("preserves the SDK's non-throwing git failure result", async () => {
    mocks.exec.mockImplementation(async (_id: string, input: ExecInput) => {
      input.onChunk({ stream: "stderr", text: "repository not found" });
      return { exitCode: 128, timedOut: false };
    });
    sandbox = await createSandbox({ provider: "e2b", sandboxId: sdk.sandboxId });
    await expect(sandbox.git.clone("https://example.com/repo.git", { dir: "/home/autopr/repo" }))
      .resolves.toMatchObject({ ok: false, exitCode: 128, stderr: "repository not found" });
  });
});
