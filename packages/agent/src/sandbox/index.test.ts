import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

import { createSandbox, getSandboxContext } from "./index";

const dependencies = {
  createDaytonaClient: vi.fn(async () => ({
    get: mocks.get,
    create: vi.fn(),
    delete: vi.fn(),
  })),
};

describe("sandbox lookup coalescing", () => {
  beforeEach(() => {
    mocks.get.mockReset();
  });

  it("shares one Daytona lookup across concurrent and cached context reads", async () => {
    const sandbox = {
      id: "sandbox-1",
      state: "started",
      autoArchiveInterval: 120,
      domainAllowList: /* SAFETY: This deliberately partial fixture implements exactly the owner-contract members exercised by this isolated test. */ undefined as string | undefined,
      start: vi.fn(),
      setAutoArchiveInterval: vi.fn(),
      updateNetworkSettings: vi.fn(async ({ domainAllowList }: { domainAllowList: string }) => {
        sandbox.domainAllowList = domainAllowList;
      }),
    };
    mocks.get.mockResolvedValue(sandbox);
    await Promise.all([
      createSandbox({ sandboxId: sandbox.id }, dependencies),
      createSandbox({ sandboxId: sandbox.id }, dependencies),
    ]);
    await getSandboxContext({
      cacheKey: "project:thread:1",
      sandboxId: sandbox.id,
      workDir: "/home/widget",
    }, dependencies);
    await getSandboxContext({
      cacheKey: "project:thread:1",
      sandboxId: sandbox.id,
      workDir: "/home/widget",
    }, dependencies);

    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(sandbox.updateNetworkSettings).toHaveBeenCalledWith({
      domainAllowList: expect.stringContaining("github.com"),
    });
  });

  it("revalidates and restarts a cached context after its short TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T00:00:00Z"));
    const sandbox = {
      id: "sandbox-2",
      state: "started",
      autoArchiveInterval: 120,
      domainAllowList: /* SAFETY: This deliberately partial fixture implements exactly the owner-contract members exercised by this isolated test. */ undefined as string | undefined,
      start: vi.fn(async () => {
        sandbox.state = "started";
      }),
      setAutoArchiveInterval: vi.fn(),
      updateNetworkSettings: vi.fn(async ({ domainAllowList }: { domainAllowList: string }) => {
        sandbox.domainAllowList = domainAllowList;
      }),
    };
    mocks.get.mockImplementation(async () => sandbox);
    try {
      await getSandboxContext({
        cacheKey: "project:thread:2",
        sandboxId: sandbox.id,
        workDir: "/home/widget",
      }, dependencies);
      sandbox.state = "stopped";
      vi.advanceTimersByTime(5_001);
      await getSandboxContext({
        cacheKey: "project:thread:2",
        sandboxId: sandbox.id,
        workDir: "/home/widget",
      }, dependencies);

      expect(mocks.get).toHaveBeenCalledTimes(2);
      expect(sandbox.start).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to start a stopped sandbox before its network policy is secured", async () => {
    const sandbox = {
      id: "sandbox-unsecured",
      state: "stopped",
      autoArchiveInterval: 120,
      domainAllowList: "*",
      start: vi.fn(),
      setAutoArchiveInterval: vi.fn(),
      updateNetworkSettings: vi.fn(),
    };
    mocks.get.mockResolvedValue(sandbox);
    await expect(createSandbox({ sandboxId: sandbox.id }, dependencies)).rejects.toThrow(
      "Refusing to start a sandbox",
    );
    expect(sandbox.start).not.toHaveBeenCalled();
    expect(sandbox.updateNetworkSettings).not.toHaveBeenCalled();
  });
});
