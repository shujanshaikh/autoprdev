import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

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
      run: vi.fn(async (_command: string, _options?: unknown) => ({ exitCode: 0, stdout: "ok", stderr: "" })),
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
    expect(mocks.create).toHaveBeenCalledWith("autopr", expect.objectContaining({
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

  it("signs expiring preview routes through the E2B preview gateway", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T12:00:00.000Z"));
    const sdk = sdkSandbox();
    const secret = "a".repeat(64);
    sdk.files.read.mockResolvedValueOnce(`${secret}\n`);
    const sandbox = new E2BSandboxAdapter(sdk as never);

    const preview = await sandbox.getSignedPreviewUrl(6_080, 600);
    const expiresAt = Math.floor(Date.now() / 1_000) + 600;
    const signature = createHmac("sha256", secret)
      .update(`${expiresAt}:6080`)
      .digest("base64url");

    expect(sdk.files.read).toHaveBeenCalledWith("/home/autopr/.autopr/preview-secret");
    expect(sdk.commands.run).toHaveBeenCalledWith(
      "/opt/autopr/bin/autopr-desktop process-status preview",
      expect.objectContaining({ timeoutMs: 30_000 }),
    );
    expect(sdk.getHost).toHaveBeenCalledWith(6_090);
    expect(preview).toEqual({
      url: `https://6090-e2b-test.e2b.test/v1/${expiresAt}/6080/${signature}`,
    });
    vi.useRealTimers();
  });

  it("converts the requested archive interval to E2B timeout milliseconds", async () => {
    const sdk = sdkSandbox();
    const sandbox = new E2BSandboxAdapter(sdk as never);

    await sandbox.setAutoArchiveInterval(120);

    expect(sdk.setTimeout).toHaveBeenCalledWith(7_200_000);
  });

  it("applies the caller deadline when resuming an E2B sandbox", async () => {
    const sdk = sdkSandbox("paused-e2b");
    const resumed = sdkSandbox("paused-e2b");
    mocks.connect.mockResolvedValueOnce(resumed);
    const sandbox = new E2BSandboxAdapter(sdk as never, { state: "paused" });

    await sandbox.start(45);

    expect(mocks.connect).toHaveBeenCalledWith("paused-e2b", {
      timeoutMs: 900_000,
      requestTimeoutMs: 45_000,
    });
    expect(sandbox.state).toBe("started");
  });

  it("groups recording startup before writing the ffmpeg pid", async () => {
    const sdk = sdkSandbox();
    const sandbox = new E2BSandboxAdapter(sdk as never);

    await sandbox.computerUse.recording.start();

    const command = sdk.commands.run.mock.calls[0]?.[0];
    expect(command).toContain("& printf '%s' \"$!\"");
    expect(command).not.toContain("& &&");
  });

  it("injects E2B secret references into SDK command environments", async () => {
    const sdk = sdkSandbox();
    sdk.files.read.mockResolvedValueOnce(JSON.stringify({ API_TOKEN: "autopr-token" }));
    const sandbox = new E2BSandboxAdapter(sdk as never);

    await sandbox.process.executeCommand("printenv", "/home/autopr/repo", { LOCAL_FLAG: "yes" });

    expect(sdk.files.read).toHaveBeenCalledWith(E2B_ENV_MANIFEST);
    expect(mocks.fill).toHaveBeenCalledWith("autopr-token");
    expect(sdk.commands.run).toHaveBeenCalledWith("printenv", expect.objectContaining({
      cwd: "/home/autopr/repo",
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

  it("applies requested timeouts to background session commands", async () => {
    const sdk = sdkSandbox();
    const handle = {
      pid: 44,
      stdout: "",
      stderr: "",
      kill: vi.fn(async () => true),
      sendStdin: vi.fn(async () => undefined),
      wait: vi.fn(() => new Promise<never>(() => undefined)),
    };
    sdk.commands.run.mockResolvedValueOnce(handle as never);
    const sandbox = new E2BSandboxAdapter(sdk as never);
    await sandbox.process.createSession("timed-session");

    await sandbox.process.executeSessionCommand(
      "timed-session",
      { command: "sleep 30", runAsync: true },
      15,
    );

    expect(sdk.commands.run).toHaveBeenCalledWith("sleep 30", expect.objectContaining({
      background: true,
      timeoutMs: 15_000,
    }));
  });

  it("records transport failures as terminal background command state", async () => {
    const sdk = sdkSandbox("failed-background-e2b");
    const handle = {
      pid: 43,
      stdout: "",
      stderr: "",
      kill: vi.fn(async () => true),
      sendStdin: vi.fn(async () => undefined),
      wait: vi.fn(async () => {
        throw new Error("connection dropped");
      }),
    };
    sdk.commands.run.mockResolvedValueOnce(handle as never);
    const sandbox = new E2BSandboxAdapter(sdk as never);
    await sandbox.process.createSession("failed-session");
    await sandbox.process.executeSessionCommand("failed-session", {
      command: "pnpm dev",
      runAsync: true,
    });

    await vi.waitFor(async () => {
      await expect(sandbox.process.getSessionCommand("failed-session", "43")).resolves.toMatchObject({
        exitCode: 1,
      });
    });
    await expect(sandbox.process.getSessionCommandLogs("failed-session", "43")).resolves.toMatchObject({
      stderr: "connection dropped",
    });
  });

  it("retains only recent terminal command state after releasing E2B handles", async () => {
    const sdk = sdkSandbox("bounded-background-e2b");
    const sandbox = new E2BSandboxAdapter(sdk as never);
    await sandbox.process.createSession("bounded-session");

    for (let pid = 100; pid <= 108; pid += 1) {
      sdk.commands.run.mockResolvedValueOnce({
        pid,
        stdout: "",
        stderr: "",
        kill: vi.fn(async () => true),
        sendStdin: vi.fn(async () => undefined),
        wait: vi.fn(async () => ({ exitCode: 0, stdout: `output-${pid}`, stderr: "" })),
      } as never);
      await sandbox.process.executeSessionCommand("bounded-session", {
        command: `command-${pid}`,
        runAsync: true,
      });
    }

    await vi.waitFor(async () => {
      await expect(sandbox.process.getSessionCommand("bounded-session", "108")).resolves.toMatchObject({
        exitCode: 0,
      });
    });
    await expect(sandbox.process.getSessionCommand("bounded-session", "100")).rejects.toThrow(
      "E2B command 100 was not found",
    );
    await expect(sandbox.process.getSessionCommandLogs("bounded-session", "108")).resolves.toMatchObject({
      stdout: "output-108",
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
