import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@daytona/sdk", () => ({
  Daytona: class {
    get = mocks.get;
  },
}));

describe("sandbox lookup coalescing", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.get.mockReset();
    delete process.env.DAYTONA_DOMAIN_ALLOW_LIST;
  });

  it("shares one Daytona lookup across concurrent and cached context reads", async () => {
    const sandbox = {
      id: "sandbox-1",
      state: "started",
      autoArchiveInterval: 120,
      domainAllowList: undefined as string | undefined,
      start: vi.fn(),
      setAutoArchiveInterval: vi.fn(),
      updateNetworkSettings: vi.fn(async ({ domainAllowList }: { domainAllowList: string }) => {
        sandbox.domainAllowList = domainAllowList;
      }),
    };
    mocks.get.mockResolvedValue(sandbox);
    const { createSandbox, getSandboxContext } = await import("./index");

    await Promise.all([
      createSandbox({ sandboxId: sandbox.id }),
      createSandbox({ sandboxId: sandbox.id }),
    ]);
    await getSandboxContext({
      cacheKey: "project:thread:1",
      sandboxId: sandbox.id,
      workDir: "/home/widget",
    });
    await getSandboxContext({
      cacheKey: "project:thread:1",
      sandboxId: sandbox.id,
      workDir: "/home/widget",
    });

    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(sandbox.updateNetworkSettings).not.toHaveBeenCalled();
  });

  it("revalidates and restarts a cached context after its short TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T00:00:00Z"));
    const sandbox = {
      id: "sandbox-2",
      state: "started",
      autoArchiveInterval: 120,
      domainAllowList: undefined as string | undefined,
      start: vi.fn(async () => {
        sandbox.state = "started";
      }),
      setAutoArchiveInterval: vi.fn(),
      updateNetworkSettings: vi.fn(async ({ domainAllowList }: { domainAllowList: string }) => {
        sandbox.domainAllowList = domainAllowList;
      }),
    };
    mocks.get.mockImplementation(async () => sandbox);
    const { getSandboxContext } = await import("./index");

    try {
      await getSandboxContext({
        cacheKey: "project:thread:2",
        sandboxId: sandbox.id,
        workDir: "/home/widget",
      });
      sandbox.state = "stopped";
      vi.advanceTimersByTime(5_001);
      await getSandboxContext({
        cacheKey: "project:thread:2",
        sandboxId: sandbox.id,
        workDir: "/home/widget",
      });

      expect(mocks.get).toHaveBeenCalledTimes(2);
      expect(sandbox.start).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts a stopped sandbox under its old restricted policy before clearing it", async () => {
    const sandbox = {
      id: "sandbox-restricted",
      state: "stopped",
      autoArchiveInterval: 120,
      domainAllowList: "github.com,registry.npmjs.org",
      start: vi.fn(async () => {
        sandbox.state = "started";
      }),
      setAutoArchiveInterval: vi.fn(),
      updateNetworkSettings: vi.fn(async ({ domainAllowList }: { domainAllowList: string }) => {
        sandbox.domainAllowList = domainAllowList;
      }),
    };
    mocks.get.mockResolvedValue(sandbox);
    const { createSandbox } = await import("./index");

    await expect(createSandbox({ sandboxId: sandbox.id })).resolves.toBe(sandbox);
    expect(sandbox.start).toHaveBeenCalledTimes(1);
    expect(sandbox.updateNetworkSettings).toHaveBeenCalledWith({ domainAllowList: "" });
  });

  it("refuses to start a stopped sandbox before applying a configured restriction", async () => {
    process.env.DAYTONA_DOMAIN_ALLOW_LIST = "github.com";
    const sandbox = {
      id: "sandbox-unsecured",
      state: "stopped",
      autoArchiveInterval: 120,
      domainAllowList: undefined as string | undefined,
      start: vi.fn(),
      setAutoArchiveInterval: vi.fn(),
      updateNetworkSettings: vi.fn(),
    };
    mocks.get.mockResolvedValue(sandbox);
    const { createSandbox } = await import("./index");

    await expect(createSandbox({ sandboxId: sandbox.id })).rejects.toThrow("Refusing to start a sandbox");
    expect(sandbox.start).not.toHaveBeenCalled();
    expect(sandbox.updateNetworkSettings).not.toHaveBeenCalled();
  });
});
