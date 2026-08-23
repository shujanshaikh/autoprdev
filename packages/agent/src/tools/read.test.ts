import { beforeEach, describe, expect, it, vi } from "vitest";

import { isPathWithinRoot, RemoteFileNotFoundError, resolveSandboxPath, SandboxPathBoundaryError } from "../sandbox/execute";

const mocks = vi.hoisted(() => ({
  currentFiles: { value: new Map<string, string>() },
  downloadRemoteFileChunk: vi.fn(),
  getSandboxContext: vi.fn(),
  resolveJailedSandboxPath: vi.fn(),
}));

// Emulates the remote `sed -n | head -c` window over the in-memory files.
mocks.downloadRemoteFileChunk.mockImplementation(
    async (options: {
      remotePath: string;
      maxBytes: number;
      startLine?: number;
      endLine?: number;
      skipBytes?: number;
      countLines?: boolean;
    }) => {
      const text = mocks.currentFiles.value.get(options.remotePath);
      if (text === undefined) {
        throw new RemoteFileNotFoundError(options.remotePath);
      }

      const buffer = Buffer.from(text, "utf8");
      let payload = buffer;
      if (options.startLine !== undefined && options.endLine !== undefined) {
        const rawLines = text.split("\n");
        const hasTrailingNewline = text.endsWith("\n");
        const lineCount = text === "" ? 0 : hasTrailingNewline ? rawLines.length - 1 : rawLines.length;
        let windowText = "";
        for (let line = options.startLine; line <= Math.min(options.endLine, lineCount); line += 1) {
          const terminated = line < lineCount || hasTrailingNewline;
          windowText += rawLines[line - 1] + (terminated ? "\n" : "");
        }
        payload = Buffer.from(windowText, "utf8");
      }

      const content = payload.subarray(options.skipBytes ?? 0, (options.skipBytes ?? 0) + options.maxBytes);
      return {
        content,
        totalBytes: buffer.length,
        totalLines: options.countLines ? (text.match(/\n/g) ?? []).length : undefined,
        reachedMaxBytes: content.length >= options.maxBytes,
      };
    },
  );

mocks.resolveJailedSandboxPath.mockImplementation(
  async (inputPath: string | undefined, options: { workDir: string }) => {
    const resolved = resolveSandboxPath(inputPath, options.workDir);
    if (!isPathWithinRoot(resolved, options.workDir)) {
      throw new SandboxPathBoundaryError(resolved, options.workDir);
    }
    return resolved;
  },
);

import { createDaytonaReadTool } from "./read";

interface ReadResult {
  content: string;
  details: {
    path: string;
    bytes: number;
    linesReturned: number;
    totalLines: number;
    truncated: boolean;
    isBinary: boolean;
  };
}

const WORK_DIR = "/workspace/repo";

function createSandboxFiles(initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles));
  mocks.currentFiles.value = files;
  const sandbox = { id: "sandbox-read-test" };
  mocks.getSandboxContext.mockResolvedValue({ sandbox, workDir: WORK_DIR });
  return { files, sandbox };
}

async function executeRead(input: { path: string; offset?: number; limit?: number; byteOffset?: number }): Promise<ReadResult> {
  const readTool = createDaytonaReadTool({ cacheKey: "read-test" }, {
    getSandboxContext: mocks.getSandboxContext,
    resolveJailedSandboxPath: mocks.resolveJailedSandboxPath,
    downloadRemoteFileChunk: mocks.downloadRemoteFileChunk,
  });
  if (!readTool.execute) {
    throw new Error("Read tool is not executable");
  }

  return /* SAFETY: This deliberately partial fixture implements exactly the owner-contract members exercised by this isolated test. */ await readTool.execute(input, { toolCallId: "read-call-1", messages: [] }) as ReadResult;
}
describe("Daytona read tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads a small file with numbered lines", async () => {
    createSandboxFiles({ [`${WORK_DIR}/a.txt`]: "one\ntwo\nthree\n" });

    const result = await executeRead({ path: "a.txt" });

    expect(result.content).toContain("Showing lines 1-4 of 4");
    expect(result.content).toContain("1 | one");
    expect(result.content).toContain("3 | three");
    expect(result.details).toMatchObject({
      path: `${WORK_DIR}/a.txt`,
      bytes: 14,
      totalLines: 4,
      truncated: false,
      isBinary: false,
    });
  });

  it("reads a line window and points at the continuation offset", async () => {
    createSandboxFiles({ [`${WORK_DIR}/long.txt`]: "l1\nl2\nl3\nl4\nl5\n" });

    const result = await executeRead({ path: "long.txt", offset: 2, limit: 2 });

    expect(result.content).toContain("Showing lines 2-3 of 6");
    expect(result.content).toContain("2 | l2");
    expect(result.content).toContain("3 | l3");
    expect(result.content).not.toContain("1 | l1");
    expect(result.content).toContain("[Use offset=4 to continue.]");
    expect(result.details.truncated).toBe(true);
  });

  it("rejects offsets beyond the end of the file", async () => {
    createSandboxFiles({ [`${WORK_DIR}/short.txt`]: "a\nb\n" });

    await expect(executeRead({ path: "short.txt", offset: 99 })).rejects.toThrow(
      `Offset 99 is beyond the end of ${WORK_DIR}/short.txt (3 lines).`,
    );
  });

  it("reports binary files instead of displaying them", async () => {
    createSandboxFiles({ [`${WORK_DIR}/bin.dat`]: "ab\0cd" });

    const result = await executeRead({ path: "bin.dat" });

    expect(result.content).toContain("appears to be binary");
    expect(result.details.isBinary).toBe(true);
  });

  it("rejects paths outside the workspace jail", async () => {
    createSandboxFiles({});

    await expect(executeRead({ path: "../../etc/passwd" })).rejects.toThrow(
      /outside the sandbox workspace/,
    );
    await expect(executeRead({ path: "/etc/passwd" })).rejects.toThrow(
      /outside the sandbox workspace/,
    );
  });

  it("stops at the byte cap and drops the partially transferred line", async () => {
    const firstLine = "a".repeat(40 * 1024);
    const secondLine = "b".repeat(40 * 1024);
    createSandboxFiles({ [`${WORK_DIR}/huge.txt`]: `${firstLine}\n${secondLine}\ntail\n` });

    const result = await executeRead({ path: "huge.txt", limit: 400 });

    // 64 KiB window cap: the first line fits, the second is cut mid-line and dropped.
    expect(result.content).toContain("Showing lines 1-1 of 4");
    expect(result.content).toContain("[Use offset=2 to continue.]");
    expect(result.content).toContain("per-read byte cap");
    expect(result.details.linesReturned).toBe(1);
    expect(result.details.truncated).toBe(true);
  });

  it("continues an oversized single line by byte offset without losing its tail", async () => {
    const hugeLine = `${"a".repeat(64 * 1024)}TAIL`;
    createSandboxFiles({ [`${WORK_DIR}/single-line.txt`]: `${hugeLine}\nnext\n` });

    const first = await executeRead({ path: "single-line.txt", limit: 2 });
    expect(first.content).toContain("final line is incomplete");
    expect(first.content).toContain("offset=1 byteOffset=65536");

    const continuation = await executeRead({
      path: "single-line.txt",
      offset: 1,
      byteOffset: 64 * 1024,
    });
    expect(continuation.content).toContain("1 | TAIL");
    expect(continuation.content).toContain("[Use offset=2 to continue.]");
  });

  it("does not split or skip a multibyte character at the byte boundary", async () => {
    const prefix = "a".repeat(64 * 1024 - 1);
    createSandboxFiles({ [`${WORK_DIR}/utf8-boundary.txt`]: `${prefix}🙂TAIL\n` });

    const first = await executeRead({ path: "utf8-boundary.txt" });
    expect(first.content).not.toContain("�");
    expect(first.content).toContain("offset=1 byteOffset=65535");

    const continuation = await executeRead({
      path: "utf8-boundary.txt",
      offset: 1,
      byteOffset: 64 * 1024 - 1,
    });
    expect(continuation.content).toContain("1 | 🙂TAIL");
    expect(continuation.content).not.toContain("�");
  });
});
