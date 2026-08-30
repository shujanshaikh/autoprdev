import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSandbox: vi.fn(),
  runAuthenticatedSandboxCommand: vi.fn(),
  sdkGitAdd: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@autopr/agent/sandbox", () => ({
  createSandbox: mocks.createSandbox,
  deleteSandbox: vi.fn(),
  DEFAULT_SANDBOX_WORKDIR: "/home/daytona",
  sandboxDefaultWorkDir: (provider: string) =>
    provider === "e2b" ? "/home/e2b" : "/home/daytona",
  sandboxRepositoryDirectoryName: () => "autopr",
  sandboxRepositoryPath: (root: string, repo: string) => `${root}/${repo}`,
}));
vi.mock("#/lib/sandbox-git-auth", () => ({
  runAuthenticatedSandboxCommand: mocks.runAuthenticatedSandboxCommand,
  withEphemeralGitAuth: vi.fn(),
}));

import {
  commitPreparedProjectSandboxChanges,
  prepareProjectSandboxCommit,
  renameProjectSandboxBranch,
} from "./daytona-project-sandbox";

describe("project sandbox commits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stages linked-worktree changes with the same Git CLI used to commit them", async () => {
    const commands: string[] = [];
    const executeSessionCommand = vi.fn(async (
      _sessionId: string,
      input: { command: string },
    ) => {
      commands.push(input.command);
      if (input.command.includes("git status --porcelain")) {
        return { exitCode: 0, result: " M apps/web/src/app.tsx\n" };
      }
      if (input.command.includes("git branch --show-current")) {
        return { exitCode: 0, result: "autopr/fix-git-actions\n" };
      }
      if (input.command.includes("git diff --cached --stat")) {
        return { exitCode: 0, result: "1 file changed, 1 insertion(+)\n" };
      }
      return { exitCode: 0, result: "" };
    });
    mocks.createSandbox.mockResolvedValue({
      git: { add: mocks.sdkGitAdd },
      process: {
        createSession: vi.fn(async () => undefined),
        executeSessionCommand,
        deleteSession: vi.fn(async () => undefined),
      },
    });

    await expect(prepareProjectSandboxCommit({
      sandboxId: "sandbox-1",
      sandboxWorkDir: "/home/.autopr/worktrees/autopr/thread-1",
    })).resolves.toMatchObject({
      branch: "autopr/fix-git-actions",
      status: "M apps/web/src/app.tsx",
    });

    expect(commands).toContain(
      "cd '/home/.autopr/worktrees/autopr/thread-1' && git add --all -- .",
    );
    expect(mocks.sdkGitAdd).not.toHaveBeenCalled();
  });

  it("repairs an index from an older failed operation before retrying the commit", async () => {
    const commands: string[] = [];
    const executeSessionCommand = vi.fn(async (
      _sessionId: string,
      input: { command: string },
    ) => {
      commands.push(input.command);
      if (input.command.includes("git branch --show-current")) {
        return { exitCode: 0, result: "autopr/fix-git-actions\n" };
      }
      if (input.command.includes("git diff --cached --name-only")) {
        return { exitCode: 0, result: "apps/web/src/app.tsx\n" };
      }
      if (input.command.includes("git rev-parse HEAD")) {
        return { exitCode: 0, result: `${"b".repeat(40)}\n` };
      }
      return { exitCode: 0, result: "" };
    });
    mocks.createSandbox.mockResolvedValue({
      git: { add: mocks.sdkGitAdd },
      process: {
        createSession: vi.fn(async () => undefined),
        executeSessionCommand,
        deleteSession: vi.fn(async () => undefined),
        executeCommand: vi.fn(async () => ({ exitCode: 0, result: "Committed" })),
      },
    });

    await expect(commitPreparedProjectSandboxChanges({
      sandboxId: "sandbox-1",
      sandboxWorkDir: "/home/.autopr/worktrees/autopr/thread-1",
      commitMessage: "fix(web): repair worktree commits",
      authorName: "Shujan Shaikh",
      authorEmail: "shujan@example.com",
    })).resolves.toMatchObject({
      branch: "autopr/fix-git-actions",
      commitSha: "b".repeat(40),
    });

    expect(commands).toContain(
      "cd '/home/.autopr/worktrees/autopr/thread-1' && git add --all -- .",
    );
    expect(mocks.sdkGitAdd).not.toHaveBeenCalled();
  });

  it("renames a temporary worktree branch without colliding with remote branches", async () => {
    const commands: string[] = [];
    const executeSessionCommand = vi.fn(async (
      _sessionId: string,
      input: { command: string },
    ) => {
      commands.push(input.command);
      if (input.command.includes("git branch --show-current")) {
        return { exitCode: 0, result: "autopr/new-thread-8a581f31e2\n" };
      }
      if (input.command.includes("git for-each-ref")) {
        return { exitCode: 0, result: "main\nautopr/new-thread-8a581f31e2\n" };
      }
      return { exitCode: 0, result: "" };
    });
    mocks.runAuthenticatedSandboxCommand.mockResolvedValue({
      exitCode: 0,
      result: `${"a".repeat(40)}\trefs/heads/autopr/fix-git-actions\n`,
    });
    mocks.createSandbox.mockResolvedValue({
      process: {
        createSession: vi.fn(async () => undefined),
        executeSessionCommand,
        deleteSession: vi.fn(async () => undefined),
      },
    });

    await expect(renameProjectSandboxBranch({
      sandboxId: "sandbox-1",
      sandboxProvider: "e2b",
      sandboxWorkDir: "/home/.autopr/worktrees/autopr/thread-1",
      expectedBranch: "autopr/new-thread-8a581f31e2",
      preferredBranch: "autopr/fix-git-actions",
      githubToken: "secret-token",
    })).resolves.toEqual({ branch: "autopr/fix-git-actions-2" });

    expect(commands.at(-1)).toBe(
      "cd '/home/.autopr/worktrees/autopr/thread-1' && git check-ref-format --branch 'autopr/fix-git-actions-2' && git branch -m -- 'autopr/new-thread-8a581f31e2' 'autopr/fix-git-actions-2'",
    );
    expect(mocks.createSandbox).toHaveBeenCalledWith({
      provider: "e2b",
      sandboxId: "sandbox-1",
    });
  });
});
