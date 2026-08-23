import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  create: vi.fn(),
  fill: vi.fn((name: string) => `secret:${name}`),
  getInfo: vi.fn(),
  kill: vi.fn(),
}));

vi.mock("e2b", () => ({
  CommandExitError: class CommandExitError extends Error {},
  Sandbox: class Sandbox {
    static connect = mocks.connect;
    static create = mocks.create;
    static getInfo = mocks.getInfo;
    static kill = mocks.kill;
  },
  SandboxNotFoundError: class SandboxNotFoundError extends Error {},
  Secret: class Secret {
    static create = vi.fn();
    static destroy = vi.fn();
    static fill = mocks.fill;
    static update = vi.fn();
  },
}));

import {
  createE2BSandbox,
  E2B_ENV_MANIFEST,
  E2BSandboxAdapter,
  getE2BSandboxWithoutStarting,
} from "./e2b";
import { SandboxRuntimeNotStartedError } from "./errors";

function sdkSandbox(id = "e2b-test") {
  return {
    sandboxId: id,
    commands: {
      run: vi.fn(async () => ({ exitCode: 0, stdout: "ok", stderr: "" })),
    },
    files: {
      list: vi.fn(async () => []),
      read: vi.fn(async () => "{}"),
      remove: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
    },
    getHost: vi.fn((port: number) => `${port}-${id}.e2b.test`),
    setTimeout: vi.fn(async () => undefined),
  };
}

describe("E2B sandbox adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates the CUA template with pause and auto-resume lifecycle settings", async () => {
    const sdk = sdkSandbox("created-e2b");
    mocks.create.mockResolvedValue(sdk);

    const sandbox = await createE2BSandbox({
      cacheKey: "project-1",
      labels: { "autopr-project-id": "project-1" },
      name: "autopr-project-1",
      provider: "e2b",
    });

    expect(sandbox.id).toBe("created-e2b");
    expect(mocks.create).toHaveBeenCalledWith("autopr-cua-e2b", expect.objectContaining({
      lifecycle: {
        onTimeout: { action: "pause", keepMemory: true },
        autoResume: true,
      },
      metadata: expect.objectContaining({
        "autopr-project-id": "project-1",
        autoprProvider: "e2b",
        autoprSandboxName: "autopr-project-1",
      }),
      network: expect.objectContaining({ allowPublicTraffic: true }),
    }));
  });

  it("runs AutoPR's CUA gateway instead of an E2B computer-use API", async () => {
    const sdk = sdkSandbox();
    const sandbox = new E2BSandboxAdapter(sdk as never);

    await sandbox.computerUse.start();

    expect(sdk.commands.run).toHaveBeenCalledWith(
      "/opt/autopr/bin/autopr-desktop start",
      expect.objectContaining({ timeoutMs: 120_000 }),
    );
  });

  it("injects E2B secret references into SDK command environments", async () => {
    const sdk = sdkSandbox();
    sdk.files.read.mockResolvedValueOnce(JSON.stringify({ API_TOKEN: "autopr-token" }));
    const sandbox = new E2BSandboxAdapter(sdk as never);

    await sandbox.process.executeCommand("printenv", "/home/daytona/repo", { LOCAL_FLAG: "yes" });

    expect(sdk.files.read).toHaveBeenCalledWith(E2B_ENV_MANIFEST);
    expect(mocks.fill).toHaveBeenCalledWith("autopr-token");
    expect(sdk.commands.run).toHaveBeenCalledWith("printenv", expect.objectContaining({
      cwd: "/home/daytona/repo",
      envs: {
        API_TOKEN: "secret:autopr-token",
        LOCAL_FLAG: "yes",
      },
    }));
  });

  it("keeps background sessions available across refreshed SDK adapters", async () => {
    const firstSdk = sdkSandbox("shared-e2b");
    const wait = vi.fn(() => new Promise<never>(() => undefined));
    const handle = {
      pid: 42,
      stdout: "server ready",
      stderr: "",
      kill: vi.fn(async () => true),
      sendStdin: vi.fn(async () => undefined),
      wait,
    };
    firstSdk.commands.run.mockResolvedValueOnce(handle as never);
    const first = new E2BSandboxAdapter(firstSdk as never);
    await first.process.createSession("session-1");
    await first.process.executeSessionCommand("session-1", {
      command: "pnpm dev",
      runAsync: true,
    });

    const refreshed = new E2BSandboxAdapter(sdkSandbox("shared-e2b") as never);

    await expect(refreshed.process.getSessionCommandLogs("session-1", "42")).resolves.toEqual({
      stdout: "server ready",
      stderr: "",
      output: "server ready",
    });
  });

  it("checks paused state without auto-resuming read-only operations", async () => {
    mocks.getInfo.mockResolvedValueOnce({ state: "paused" });

    await expect(getE2BSandboxWithoutStarting("paused-e2b")).rejects.toMatchObject({
      code: "SANDBOX_RUNTIME_NOT_STARTED",
      state: "paused",
    } satisfies Partial<SandboxRuntimeNotStartedError>);
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
