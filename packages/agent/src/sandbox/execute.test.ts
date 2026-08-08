import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeSessionCommand: vi.fn(),
  getSandboxContext: vi.fn(),
}));

vi.mock("./index", () => ({
  getSandboxContext: mocks.getSandboxContext,
}));

import {
  downloadRemoteFileChunk,
  isPathWithinRoot,
  RemoteFileNotFoundError,
  resolveJailedSandboxPath,
  resolveSandboxPath,
  SandboxPathBoundaryError,
} from "./execute";

const WORK_DIR = "/work/repo";

const fakeSandbox = {
  id: "sandbox-execute-test",
  process: {
    createSession: vi.fn(async () => ({})),
    executeSessionCommand: mocks.executeSessionCommand,
    deleteSession: vi.fn(async () => ({})),
  },
};

/** Unwraps the `'\''`-escaped single-quoted tokens embedded in our commands. */
function extractQuotedTokens(segment: string): string[] {
  return [...segment.matchAll(/'\\''(.*?)'\\''/gs)].map((match) => match[1]!);
}

function resolveEmulated(path: string, symlinks: Record<string, string>): string {
  for (const [link, target] of Object.entries(symlinks)) {
    if (path === link) {
      return target;
    }
    if (path.startsWith(`${link}/`)) {
      return `${target}${path.slice(link.length)}`;
    }
  }
  return path;
}

function emulateCanonicalize(command: string, symlinks: Record<string, string>) {
  const region = /for p in (.*?); do/s.exec(command)?.[1] ?? "";
  const paths = extractQuotedTokens(region);
  return {
    cmdId: "cmd-canonicalize",
    exitCode: 0,
    stdout: `${paths.map((path) => resolveEmulated(path, symlinks)).join("\n")}\n`,
  };
}

function emulateDownload(command: string, files: Record<string, string>) {
  const path = /wc(?: -l)? -c < '\\''(.*?)'\\''/s.exec(command)?.[1];
  if (!path) {
    throw new Error(`Could not find download path in command: ${command}`);
  }

  const text = files[path];
  if (text === undefined) {
    return { cmdId: "cmd-download", exitCode: 43, stderr: `remote file not found: ${path}` };
  }

  const buffer = Buffer.from(text, "utf8");
  const newlineCount = (text.match(/\n/g) ?? []).length;
  const countLines = command.includes("wc -l -c <");
  const meta = countLines ? `${newlineCount} ${buffer.length}` : `${buffer.length}`;

  const cap = Number(/head -c (\d+)/.exec(command)?.[1]);
  const sedRange = /sed -n '\\''(\d+),(\d+)p'\\''/.exec(command);

  let payload = buffer;
  if (sedRange) {
    const startLine = Number(sedRange[1]);
    const endLine = Number(sedRange[2]);
    const rawLines = text.split("\n");
    const hasTrailingNewline = text.endsWith("\n");
    const lineCount = text === "" ? 0 : hasTrailingNewline ? rawLines.length - 1 : rawLines.length;
    let windowText = "";
    for (let line = startLine; line <= Math.min(endLine, lineCount); line += 1) {
      const terminated = line < lineCount || hasTrailingNewline;
      windowText += rawLines[line - 1] + (terminated ? "\n" : "");
    }
    payload = Buffer.from(windowText, "utf8");
  }

  const skippedBytes = Number(/tail -c \+(\d+)/.exec(command)?.[1] ?? 1) - 1;
  if (skippedBytes > 0) payload = payload.subarray(skippedBytes);

  const capped = payload.subarray(0, cap);
  return {
    cmdId: "cmd-download",
    exitCode: 0,
    stdout: `${meta}\n${capped.toString("base64")}`,
  };
}

function emulateRemote(
  options: { files?: Record<string, string>; symlinks?: Record<string, string> } = {},
) {
  return async (_sessionId: string, request: { command: string }) => {
    if (request.command.includes("realpath -m")) {
      return emulateCanonicalize(request.command, options.symlinks ?? {});
    }
    if (request.command.includes("| base64 |")) {
      return emulateDownload(request.command, options.files ?? {});
    }
    throw new Error(`Unexpected sandbox command: ${request.command}`);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSandboxContext.mockResolvedValue({ sandbox: fakeSandbox, workDir: WORK_DIR });
});

describe("isPathWithinRoot", () => {
  it("accepts the root itself and nested paths", () => {
    expect(isPathWithinRoot("/work/repo", "/work/repo")).toBe(true);
    expect(isPathWithinRoot("/work/repo/src/a.ts", "/work/repo")).toBe(true);
  });

  it("rejects siblings, parents, and prefix lookalikes", () => {
    expect(isPathWithinRoot("/work/repo2", "/work/repo")).toBe(false);
    expect(isPathWithinRoot("/work", "/work/repo")).toBe(false);
    expect(isPathWithinRoot("/etc/passwd", "/work/repo")).toBe(false);
  });

  it("treats a root of / as containing every absolute path", () => {
    expect(isPathWithinRoot("/etc/passwd", "/")).toBe(true);
    expect(isPathWithinRoot("relative/path", "/")).toBe(false);
  });
});

describe("resolveJailedSandboxPath", () => {
  it("resolves in-workspace relative paths after canonicalization", async () => {
    mocks.executeSessionCommand.mockImplementation(emulateRemote());

    await expect(
      resolveJailedSandboxPath("src/a.ts", { workDir: WORK_DIR, sandboxOptions: {} }),
    ).resolves.toBe(`${WORK_DIR}/src/a.ts`);

    const commands = mocks.executeSessionCommand.mock.calls.map((call) => call[1].command as string);
    expect(commands).toHaveLength(2);
    expect(commands.every((command) => command.includes("realpath -m"))).toBe(true);
    expect(commands.some((command) => command.includes(WORK_DIR))).toBe(true);
  });

  it("rejects absolute escapes without a sandbox round trip", async () => {
    await expect(
      resolveJailedSandboxPath("/etc/passwd", { workDir: WORK_DIR, sandboxOptions: {} }),
    ).rejects.toBeInstanceOf(SandboxPathBoundaryError);
    expect(mocks.executeSessionCommand).not.toHaveBeenCalled();
  });

  it("rejects ../ traversal that collapses outside the workspace", async () => {
    await expect(
      resolveJailedSandboxPath("../../../etc/passwd", { workDir: WORK_DIR, sandboxOptions: {} }),
    ).rejects.toBeInstanceOf(SandboxPathBoundaryError);
    expect(mocks.executeSessionCommand).not.toHaveBeenCalled();
  });

  it("rejects symlink escapes that pass the lexical check", async () => {
    mocks.executeSessionCommand.mockImplementation(
      emulateRemote({ symlinks: { [`${WORK_DIR}/link`]: "/etc" } }),
    );

    await expect(
      resolveJailedSandboxPath("link/passwd", { workDir: WORK_DIR, sandboxOptions: {} }),
    ).rejects.toBeInstanceOf(SandboxPathBoundaryError);
  });

  it("allows paths under explicitly added roots", async () => {
    mocks.executeSessionCommand.mockImplementation(emulateRemote());

    await expect(
      resolveJailedSandboxPath("/data/cache/blob", {
        workDir: WORK_DIR,
        sandboxOptions: {},
        extraAllowedRoots: ["/data"],
      }),
    ).resolves.toBe("/data/cache/blob");
  });

  it("caches canonical roots per sandbox while rechecking each candidate", async () => {
    mocks.getSandboxContext.mockResolvedValue({
      sandbox: { ...fakeSandbox, id: "sandbox-cache-test" },
      workDir: WORK_DIR,
    });
    mocks.executeSessionCommand.mockImplementation(emulateRemote());

    await resolveJailedSandboxPath("src/a.ts", { workDir: WORK_DIR, sandboxOptions: {} });
    await resolveJailedSandboxPath("src/b.ts", { workDir: WORK_DIR, sandboxOptions: {} });

    expect(mocks.executeSessionCommand).toHaveBeenCalledTimes(3);
  });

  it("rejects paths containing newlines", async () => {
    await expect(
      resolveJailedSandboxPath("src/a.ts\n/etc/passwd", { workDir: WORK_DIR, sandboxOptions: {} }),
    ).rejects.toBeInstanceOf(SandboxPathBoundaryError);
  });
});

describe("downloadRemoteFileChunk", () => {
  it("downloads a whole small file with its remote size", async () => {
    mocks.executeSessionCommand.mockImplementation(
      emulateRemote({ files: { "/work/repo/a.txt": "hello\n" } }),
    );

    const chunk = await downloadRemoteFileChunk({
      remotePath: "/work/repo/a.txt",
      maxBytes: 1024,
      sandboxOptions: {},
    });

    expect(chunk.content.toString("utf8")).toBe("hello\n");
    expect(chunk.totalBytes).toBe(6);
    expect(chunk.reachedMaxBytes).toBe(false);

    const command = mocks.executeSessionCommand.mock.calls[0]![1].command as string;
    expect(command).toContain("head -c 1024 --");
    expect(command).not.toContain("sed -n");
  });

  it("caps the transferred bytes at maxBytes", async () => {
    mocks.executeSessionCommand.mockImplementation(
      emulateRemote({ files: { "/work/repo/big.txt": "x".repeat(4096) } }),
    );

    const chunk = await downloadRemoteFileChunk({
      remotePath: "/work/repo/big.txt",
      maxBytes: 512,
      sandboxOptions: {},
    });

    expect(chunk.content.length).toBe(512);
    expect(chunk.totalBytes).toBe(4096);
    expect(chunk.reachedMaxBytes).toBe(true);
  });

  it("downloads a line window with line and byte counts", async () => {
    mocks.executeSessionCommand.mockImplementation(
      emulateRemote({ files: { "/work/repo/lines.txt": "one\ntwo\nthree\n" } }),
    );

    const chunk = await downloadRemoteFileChunk({
      remotePath: "/work/repo/lines.txt",
      maxBytes: 1024,
      startLine: 2,
      endLine: 3,
      countLines: true,
      sandboxOptions: {},
    });

    expect(chunk.content.toString("utf8")).toBe("two\nthree\n");
    expect(chunk.totalLines).toBe(3);
    expect(chunk.totalBytes).toBe(14);

    const command = mocks.executeSessionCommand.mock.calls[0]![1].command as string;
    expect(command).toContain("sed -n");
    expect(command).toContain("2,3p");
    expect(command).not.toContain("set -o pipefail");
  });

  it("skips bytes within a selected line before applying the cap", async () => {
    mocks.executeSessionCommand.mockImplementation(
      emulateRemote({ files: { "/work/repo/line.txt": "abcdefghij\n" } }),
    );

    const chunk = await downloadRemoteFileChunk({
      remotePath: "/work/repo/line.txt",
      maxBytes: 4,
      startLine: 1,
      endLine: 1,
      skipBytes: 4,
      sandboxOptions: {},
    });

    expect(chunk.content.toString("utf8")).toBe("efgh");
  });

  it("throws RemoteFileNotFoundError for missing files", async () => {
    mocks.executeSessionCommand.mockImplementation(emulateRemote());

    await expect(
      downloadRemoteFileChunk({ remotePath: "/work/repo/missing.txt", maxBytes: 16, sandboxOptions: {} }),
    ).rejects.toBeInstanceOf(RemoteFileNotFoundError);
  });

  it("throws a descriptive error when the sandbox command fails", async () => {
    mocks.executeSessionCommand.mockResolvedValue({
      cmdId: "cmd-failed",
      exitCode: 1,
      stderr: "boom",
    });

    await expect(
      downloadRemoteFileChunk({ remotePath: "/work/repo/a.txt", maxBytes: 16, sandboxOptions: {} }),
    ).rejects.toThrow("boom");
  });

  it("rejects invalid byte caps before touching the sandbox", async () => {
    await expect(
      downloadRemoteFileChunk({ remotePath: "/work/repo/a.txt", maxBytes: 0, sandboxOptions: {} }),
    ).rejects.toThrow("Invalid download byte cap");
    expect(mocks.executeSessionCommand).not.toHaveBeenCalled();
  });
});

describe("resolveSandboxPath", () => {
  it("still resolves relative paths against the workdir lexically", () => {
    expect(resolveSandboxPath("src/../package.json", WORK_DIR)).toBe(`${WORK_DIR}/package.json`);
    expect(resolveSandboxPath(undefined, WORK_DIR)).toBe(WORK_DIR);
    expect(resolveSandboxPath("/abs/path", WORK_DIR)).toBe("/abs/path");
  });
});
