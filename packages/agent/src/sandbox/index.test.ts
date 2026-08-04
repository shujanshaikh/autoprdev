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
  });

  it("shares one Daytona lookup across concurrent and cached context reads", async () => {
    const sandbox = {
      id: "sandbox-1",
      state: "started",
      autoArchiveInterval: 120,
      start: vi.fn(),
      setAutoArchiveInterval: vi.fn(),
      updateNetworkSettings: vi.fn(),
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
    expect(sandbox.updateNetworkSettings).toHaveBeenCalledWith({
      domainAllowList: expect.stringContaining("github.com"),
    });
  });
});
