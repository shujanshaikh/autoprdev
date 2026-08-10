import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeAutoprFff: vi.fn(),
  getSandboxContext: vi.fn(),
  resolveJailedSandboxPath: vi.fn(),
}));

vi.mock("../sandbox", () => ({ getSandboxContext: mocks.getSandboxContext }));
vi.mock("../sandbox/execute", () => ({ resolveJailedSandboxPath: mocks.resolveJailedSandboxPath }));
vi.mock("./fff", () => ({ executeAutoprFff: mocks.executeAutoprFff }));

import { createDaytonaFindTool } from "./find";
import { createDaytonaGrepTool } from "./grep";

function safeParse(schema: unknown, value: unknown): { success: boolean } {
  return (schema as { safeParse(input: unknown): { success: boolean } }).safeParse(value);
}

async function execute(toolName: "find" | "grep", input: Record<string, unknown>) {
  const instance = toolName === "find"
    ? createDaytonaFindTool({ cacheKey: "search-test" })
    : createDaytonaGrepTool({ cacheKey: "search-test" });
  if (!instance.execute) throw new Error(`${toolName} tool is not executable`);
  return await instance.execute(input, { toolCallId: `${toolName}-1`, messages: [] }) as {
    content: string;
    details: Record<string, unknown>;
  };
}

describe("Daytona search tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSandboxContext.mockResolvedValue({
      sandbox: { id: "sandbox-search" },
      workDir: "/workspace/repo",
    });
    mocks.resolveJailedSandboxPath.mockImplementation(async (path: string) => `/workspace/repo/${path}`);
  });

  it("canonicalizes find and grep scopes through the workspace jail", async () => {
    mocks.executeAutoprFff
      .mockResolvedValueOnce({ ok: true, exitCode: 0, value: { items: [], totalMatched: 0 } })
      .mockResolvedValueOnce({ ok: true, exitCode: 0, value: { items: [], totalMatched: 0 } });

    await execute("find", { pattern: "agent", path: "src" });
    await execute("grep", { pattern: "createAgent", path: "src" });

    expect(mocks.resolveJailedSandboxPath).toHaveBeenNthCalledWith(1, "src", {
      workDir: "/workspace/repo",
      sandboxOptions: { cacheKey: "search-test" },
    });
    expect(mocks.resolveJailedSandboxPath).toHaveBeenNthCalledWith(2, "src", {
      workDir: "/workspace/repo",
      sandboxOptions: { cacheKey: "search-test" },
    });
  });

  it("surfaces FFF failures as failed tool calls", async () => {
    mocks.executeAutoprFff.mockResolvedValue({
      ok: false,
      exitCode: 127,
      error: "fff runtime missing",
    });

    await expect(execute("find", { pattern: "agent" })).rejects.toThrow("fff runtime missing");
    await expect(execute("grep", { pattern: "agent" })).rejects.toThrow("fff runtime missing");
  });

  it("bounds native grep work and rejects match-everything patterns", async () => {
    mocks.executeAutoprFff.mockResolvedValue({
      ok: true,
      exitCode: 0,
      value: { items: [], totalMatched: 0 },
    });

    await execute("grep", { pattern: "createAgent" });
    expect(mocks.executeAutoprFff).toHaveBeenCalledWith(
      "grep",
      expect.objectContaining({ "time-budget-ms": 10_000 }),
      { cacheKey: "search-test" },
    );

    await expect(execute("grep", { pattern: ".*" })).rejects.toThrow(
      "requires a concrete substring",
    );
    expect(mocks.executeAutoprFff).toHaveBeenCalledTimes(1);
  });

  it("withholds pagination cursors when output truncation would skip unseen find results", async () => {
    mocks.executeAutoprFff.mockResolvedValue({
      ok: true,
      exitCode: 0,
      value: {
        items: Array.from({ length: 30 }, (_, index) => ({
          relativePath: `${index}-${"nested/".repeat(120)}file.ts`,
        })),
        nextCursor: "unsafe-next-page",
        totalMatched: 100,
      },
    });

    const result = await execute("find", { pattern: "file" });
    expect(result.content).toContain("cursor was withheld");
    expect(result.details).toMatchObject({ hasMore: true, nextCursor: null, truncated: true });
  });

  it("withholds pagination cursors when formatted grep context exceeds the output cap", async () => {
    mocks.executeAutoprFff.mockResolvedValue({
      ok: true,
      exitCode: 0,
      value: {
        items: Array.from({ length: 40 }, (_, index) => ({
          relativePath: `src/file-${index}.ts`,
          lineNumber: 1,
          lineContent: "x".repeat(900),
        })),
        nextCursor: "unsafe-next-page",
        totalMatched: 100,
      },
    });

    const result = await execute("grep", { pattern: "x" });
    expect(result.content).toContain("cursor was withheld");
    expect(result.details).toMatchObject({ hasMore: true, nextCursor: null, truncated: true });
  });

  it("rejects contradictory grep case settings at the schema boundary", () => {
    const grep = createDaytonaGrepTool({ cacheKey: "search-schema" });
    expect(safeParse(grep.inputSchema, {
      pattern: "value",
      ignoreCase: true,
      caseSensitive: true,
    }).success).toBe(false);
  });
});
