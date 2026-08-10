import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSandboxContext: vi.fn(),
  resolveJailedSandboxPath: vi.fn(),
}));

vi.mock("../sandbox", () => ({ getSandboxContext: mocks.getSandboxContext }));
vi.mock("../sandbox/execute", () => ({ resolveJailedSandboxPath: mocks.resolveJailedSandboxPath }));

import { createDaytonaLsTool } from "./ls";

async function executeLs(input: { path?: string; offset?: number; limit?: number }) {
  const ls = createDaytonaLsTool({ cacheKey: "ls-test" });
  if (!ls.execute) throw new Error("ls tool is not executable");
  return await ls.execute(input, { toolCallId: "ls-1", messages: [] }) as {
    content: string;
    details: Record<string, unknown>;
  };
}

describe("Daytona ls tool", () => {
  const listFiles = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveJailedSandboxPath.mockResolvedValue("/workspace/repo");
    mocks.getSandboxContext.mockResolvedValue({
      sandbox: { id: "sandbox-ls", fs: { listFiles } },
      workDir: "/workspace/repo",
    });
  });

  it("sorts and paginates listings without silently skipping entries", async () => {
    listFiles.mockResolvedValue([
      { name: "z.ts", size: 10, permissions: "-rw-r--r--" },
      { name: "a", isDir: true, permissions: "drwxr-xr-x" },
      { name: "b.ts", size: 20, permissions: "-rw-r--r--" },
    ]);

    const first = await executeLs({ limit: 2 });
    expect(first.content).toContain("Showing entries 1-2 of 3");
    expect(first.content).toContain("a/");
    expect(first.content).toContain("b.ts");
    expect(first.content).toContain("Use offset=3 to continue");
    expect(first.details).toMatchObject({ totalEntries: 3, hasMore: true, nextOffset: 3 });

    const second = await executeLs({ offset: 3, limit: 2 });
    expect(second.content).toContain("z.ts");
    expect(second.details).toMatchObject({ hasMore: false, nextOffset: null });
  });

  it("distinguishes an empty directory from an invalid continuation offset", async () => {
    listFiles.mockResolvedValueOnce([]);
    await expect(executeLs({})).resolves.toMatchObject({
      details: { entries: 0, totalEntries: 0, hasMore: false },
    });

    listFiles.mockResolvedValueOnce([{ name: "only.ts" }]);
    await expect(executeLs({ offset: 2 })).rejects.toThrow("Offset 2 is beyond the end");
  });

  it("resolves the requested directory through the workspace jail", async () => {
    mocks.resolveJailedSandboxPath.mockRejectedValueOnce(new Error("outside the sandbox workspace"));
    await expect(executeLs({ path: "../../etc" })).rejects.toThrow("outside the sandbox workspace");
    expect(listFiles).not.toHaveBeenCalled();
  });
});
