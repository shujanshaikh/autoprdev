import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSandboxContext: vi.fn(),
}));
vi.mock("../sandbox", () => ({ getSandboxContext: mocks.getSandboxContext }));

import { createDaytonaSandboxInfoTool } from "./sandbox-info";

describe("Daytona sandboxInfo tool", () => {
  it("reports lifecycle metadata needed to diagnose a resumed sandbox", async () => {
    mocks.getSandboxContext.mockResolvedValue({
      sandbox: {
        id: "sandbox-1",
        name: "autopr-thread",
        snapshot: "autopr-cua",
        state: "started",
        autoArchiveInterval: 120,
      },
      workDir: "/workspace/repo",
    });
    const info = createDaytonaSandboxInfoTool({ cacheKey: "info-test" });
    if (!info.execute) throw new Error("sandboxInfo tool is not executable");

    const result = await info.execute({}, { toolCallId: "info-1", messages: [] }) as {
      content: string;
      details: Record<string, unknown>;
    };
    expect(result.content).toContain("State: started");
    expect(result.details).toMatchObject({ state: "started", autoArchiveInterval: 120 });
  });
});
