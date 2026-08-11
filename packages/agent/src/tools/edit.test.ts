import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DaytonaSandbox } from "../sandbox";

const mocks = vi.hoisted(() => ({
  currentFiles: { value: new Map<string, Buffer>() },
  downloadRemoteFileChunk: vi.fn(),
  ensureRemoteParentDirectory: vi.fn(),
  getSandboxContext: vi.fn(),
  resolveJailedSandboxPath: vi.fn(),
}));

vi.mock("../sandbox", () => ({
  getSandboxContext: mocks.getSandboxContext,
}));

vi.mock("../sandbox/execute", async (importOriginal) => {
  const original = await importOriginal<typeof import("../sandbox/execute")>();
  mocks.resolveJailedSandboxPath.mockImplementation(
    async (inputPath: string, options: { workDir: string }) => {
      const resolved = original.resolveSandboxPath(inputPath, options.workDir);
      if (!original.isPathWithinRoot(resolved, options.workDir)) {
        throw new original.SandboxPathBoundaryError(resolved, options.workDir);
      }
      return resolved;
    },
  );
  mocks.downloadRemoteFileChunk.mockImplementation(async (options: { remotePath: string; maxBytes: number }) => {
    const content = mocks.currentFiles.value.get(options.remotePath);
    if (!content) throw new original.RemoteFileNotFoundError(options.remotePath);
    return {
      content: content.subarray(0, options.maxBytes),
      totalBytes: content.length,
      reachedMaxBytes: content.length >= options.maxBytes,
    };
  });
  return {
    ...original,
    downloadRemoteFileChunk: mocks.downloadRemoteFileChunk,
    ensureRemoteParentDirectory: mocks.ensureRemoteParentDirectory,
    resolveJailedSandboxPath: mocks.resolveJailedSandboxPath,
  };
});

import { createDaytonaEditTool } from "./edit";

const WORK_DIR = "/workspace/repo";

function prepareFile(path: string, content: string | Buffer) {
  const files = new Map([[path, Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8")]]);
  mocks.currentFiles.value = files;
  const uploadFile = vi.fn(async (next: Uint8Array, remotePath: string) => {
    files.set(remotePath, Buffer.from(next));
  });
  const sandbox = { id: "sandbox-edit", fs: { uploadFile } } as unknown as DaytonaSandbox;
  mocks.getSandboxContext.mockResolvedValue({ sandbox, workDir: WORK_DIR });
  return { files, uploadFile };
}

async function executeEdit(input: {
  path: string;
  edits: Array<{ oldText: string; newText: string }>;
}) {
  const edit = createDaytonaEditTool({ cacheKey: "edit-test" });
  if (!edit.execute) throw new Error("Edit tool is not executable");
  return await edit.execute(input, { toolCallId: "edit-1", messages: [] }) as {
    content: string;
    details: { replacements: number; diff: { patch: string; patchOmitted?: boolean } };
  };
}

describe("Daytona edit tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureRemoteParentDirectory.mockResolvedValue(undefined);
  });

  it("applies multiple disjoint replacements against the original file", async () => {
    const path = `${WORK_DIR}/src/a.ts`;
    const remote = prepareFile(path, "const first = 1;\nconst second = 2;\n");

    const result = await executeEdit({
      path: "src/a.ts",
      edits: [
        { oldText: "first = 1", newText: "first = 10" },
        { oldText: "second = 2", newText: "second = 20" },
      ],
    });

    expect(remote.files.get(path)?.toString("utf8")).toBe("const first = 10;\nconst second = 20;\n");
    expect(result.details.replacements).toBe(2);
    expect(result.details.diff.patch).toContain("+const first = 10;");
  });

  it("preserves a UTF-8 BOM and CRLF line endings", async () => {
    const path = `${WORK_DIR}/windows.ts`;
    const remote = prepareFile(path, "\uFEFFconst a = 1;\r\nconst b = 2;\r\n");

    await executeEdit({
      path: "windows.ts",
      edits: [{ oldText: "const b = 2;\n", newText: "const b = 3;\n" }],
    });

    expect(remote.files.get(path)?.toString("utf8")).toBe("\uFEFFconst a = 1;\r\nconst b = 3;\r\n");
  });

  it("rejects ambiguous, overlapping, and no-op replacements before upload", async () => {
    const path = `${WORK_DIR}/a.txt`;
    const remote = prepareFile(path, "same same\nabcdef\n");

    await expect(executeEdit({
      path: "a.txt",
      edits: [{ oldText: "same", newText: "changed" }],
    })).rejects.toThrow("matched more than once");
    await expect(executeEdit({
      path: "a.txt",
      edits: [
        { oldText: "abcdef", newText: "one" },
        { oldText: "bcd", newText: "two" },
      ],
    })).rejects.toThrow("overlap");
    await expect(executeEdit({
      path: "a.txt",
      edits: [{ oldText: "abcdef", newText: "abcdef" }],
    })).rejects.toThrow("identical");
    expect(remote.uploadFile).not.toHaveBeenCalled();
  });

  it("rejects binary files instead of corrupting them as UTF-8", async () => {
    const path = `${WORK_DIR}/asset.bin`;
    const remote = prepareFile(path, Buffer.from([0, 1, 2, 65, 66]));

    await expect(executeEdit({
      path: "asset.bin",
      edits: [{ oldText: "AB", newText: "CD" }],
    })).rejects.toThrow("appears to be binary");
    expect(remote.uploadFile).not.toHaveBeenCalled();
  });

  it("rejects paths outside the workspace jail", async () => {
    const remote = prepareFile(`${WORK_DIR}/a.txt`, "safe\n");
    await expect(executeEdit({
      path: "../../etc/passwd",
      edits: [{ oldText: "root", newText: "nope" }],
    })).rejects.toThrow("outside the sandbox workspace");
    expect(remote.uploadFile).not.toHaveBeenCalled();
  });
});
