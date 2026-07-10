import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { DaytonaSandbox } from "../sandbox";

const mocks = vi.hoisted(() => ({
  ensureRemoteParentDirectory: vi.fn(),
  getSandboxContext: vi.fn(),
}));

vi.mock("../sandbox", () => ({
  getSandboxContext: mocks.getSandboxContext,
}));

vi.mock("../sandbox/execute", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sandbox/execute")>()),
  ensureRemoteParentDirectory: mocks.ensureRemoteParentDirectory,
}));

import { createDaytonaWriteTool } from "./write";

interface WriteResult {
  content: string;
  details: {
    path: string;
    bytesWritten: number;
    previousExists: boolean;
    unchanged: boolean;
    diff: {
      patch: string;
      status: "added" | "modified";
    };
  };
}

function createSandboxFiles(initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles));
  const downloadFile = vi.fn(async (remotePath: string) => {
    const content = files.get(remotePath);
    if (content === undefined) {
      throw Object.assign(new Error(`Missing file: ${remotePath}`), { statusCode: 404 });
    }
    return Buffer.from(content, "utf8");
  });
  const uploadFile = vi.fn(async (content: Uint8Array, remotePath: string) => {
    files.set(remotePath, Buffer.from(content).toString("utf8"));
  });
  const sandbox = {
    id: "sandbox-1",
    fs: { downloadFile, uploadFile },
  } as unknown as DaytonaSandbox;

  return { downloadFile, files, sandbox, uploadFile };
}

async function executeWrite(input: { path: string; content: string }): Promise<WriteResult> {
  const writeTool = createDaytonaWriteTool({ cacheKey: "write-test" });
  if (!writeTool.execute) {
    throw new Error("Write tool is not executable");
  }

  return await writeTool.execute(input, { toolCallId: "write-call-1", messages: [] }) as WriteResult;
}

describe("Daytona write tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureRemoteParentDirectory.mockResolvedValue(undefined);
  });

  it("exposes the same simple path-and-content contract as Pi without a small content cap", () => {
    const writeTool = createDaytonaWriteTool({ cacheKey: "write-schema-test" });
    expect(writeTool.inputSchema).toBeInstanceOf(z.ZodObject);

    const schema = writeTool.inputSchema as z.ZodObject;
    expect(Object.keys(schema.shape)).toEqual(["path", "content"]);
    expect(schema.safeParse({ path: "large.txt", content: "x".repeat(25_000) }).success).toBe(true);
  });

  it("creates parent directories and writes complete content to a new sandbox file", async () => {
    const remote = createSandboxFiles();
    mocks.getSandboxContext.mockResolvedValue({ sandbox: remote.sandbox, workDir: "/workspace/repo" });

    const result = await executeWrite({ path: "src/new.ts", content: "export const value = 1;\n" });

    expect(mocks.ensureRemoteParentDirectory).toHaveBeenCalledWith(
      "/workspace/repo/src/new.ts",
      { cacheKey: "write-test" },
    );
    expect(remote.files.get("/workspace/repo/src/new.ts")).toBe("export const value = 1;\n");
    expect(result.content).toContain("Successfully wrote");
    expect(result.details).toMatchObject({
      path: "/workspace/repo/src/new.ts",
      previousExists: false,
      unchanged: false,
      diff: { status: "added" },
    });
  });

  it("fully overwrites an existing file and returns its diff", async () => {
    const remotePath = "/workspace/repo/src/existing.ts";
    const remote = createSandboxFiles({ [remotePath]: "const value = 1;\n" });
    mocks.getSandboxContext.mockResolvedValue({ sandbox: remote.sandbox, workDir: "/workspace/repo" });

    const result = await executeWrite({ path: "src/existing.ts", content: "const value = 2;\n" });

    expect(remote.files.get(remotePath)).toBe("const value = 2;\n");
    expect(result.details.diff.status).toBe("modified");
    expect(result.details.diff.patch).toContain("-const value = 1;");
    expect(result.details.diff.patch).toContain("+const value = 2;");
  });

  it("does not upload when the target already has identical content", async () => {
    const remotePath = "/workspace/repo/unchanged.txt";
    const remote = createSandboxFiles({ [remotePath]: "already correct\n" });
    mocks.getSandboxContext.mockResolvedValue({ sandbox: remote.sandbox, workDir: "/workspace/repo" });

    const result = await executeWrite({ path: "unchanged.txt", content: "already correct\n" });

    expect(remote.uploadFile).not.toHaveBeenCalled();
    expect(mocks.ensureRemoteParentDirectory).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({ bytesWritten: 0, previousExists: true, unchanged: true });
  });

  it("can replace an existing file with empty content", async () => {
    const remotePath = "/workspace/repo/empty.txt";
    const remote = createSandboxFiles({ [remotePath]: "remove me" });
    mocks.getSandboxContext.mockResolvedValue({ sandbox: remote.sandbox, workDir: "/workspace/repo" });

    const result = await executeWrite({ path: "empty.txt", content: "" });

    expect(remote.files.get(remotePath)).toBe("");
    expect(result.details).toMatchObject({ bytesWritten: 0, previousExists: true, unchanged: false });
    expect(result.details.diff.patch).toContain("-remove me");
  });

  it("does not mistake Daytona read failures for missing files", async () => {
    const remote = createSandboxFiles();
    remote.downloadFile.mockRejectedValueOnce(Object.assign(new Error("Permission denied"), { statusCode: 403 }));
    mocks.getSandboxContext.mockResolvedValue({ sandbox: remote.sandbox, workDir: "/workspace/repo" });

    await expect(executeWrite({ path: "protected.txt", content: "replacement" })).rejects.toThrow(
      "Permission denied",
    );
    expect(remote.uploadFile).not.toHaveBeenCalled();
  });
});
