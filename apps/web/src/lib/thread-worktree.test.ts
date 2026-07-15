import { describe, expect, it } from "vitest";

import {
  assessWorktreeCleanup,
  createThreadFeatureBranch,
  createThreadWorktreePath,
  decideWorktreeProvision,
  parseGitWorktreeList,
  resolveThreadBaseBranch,
  resolveThreadExecutionPath,
} from "@autopr/backend/convex/lib/threadWorktree";
import { threadSandboxCacheKey } from "./trigger-agent-contract";

describe("thread worktree metadata", () => {
  it("generates safe, deterministic, unique feature branch names", () => {
    const branch = createThreadFeatureBranch("Fix: spaces, ünicode & refs.lock", "thread/ABC-123");

    expect(branch).toBe("autopr/fix-spaces-unicode-refs-lock-abc-123");
    expect(branch).toMatch(/^autopr\/[a-z0-9][a-z0-9-]*$/);
    expect(branch.length).toBeLessThanOrEqual(120);
    expect(createThreadFeatureBranch("Fix: spaces, ünicode & refs.lock", "thread/ABC-123")).toBe(branch);
    expect(createThreadFeatureBranch("Fix: spaces, ünicode & refs.lock", "thread/ABC-124")).not.toBe(branch);
  });

  it("resolves deterministic paths outside the shared checkout", () => {
    expect(createThreadWorktreePath("/home/autopr", "AutoPR", "Thread 123")).toBe(
      "/home/.autopr/worktrees/autopr/thread-123",
    );
    expect(resolveThreadExecutionPath({ worktreePath: "/home/.autopr/worktrees/autopr/one" }, "/home/autopr"))
      .toBe("/home/.autopr/worktrees/autopr/one");
    expect(threadSandboxCacheKey("project-cache", "thread-1")).toBe("project-cache:thread:thread-1");
    expect(threadSandboxCacheKey("project-cache", "thread-2")).not.toBe(
      threadSandboxCacheKey("project-cache", "thread-1"),
    );
  });

  it("provides safe lazy-migration fallbacks for existing thread metadata", () => {
    expect(resolveThreadBaseBranch({}, {
      currentBranch: "release",
      repoBranch: "main",
      defaultBranch: "trunk",
    })).toBe("release");
    expect(resolveThreadBaseBranch({ baseBranch: "main" }, {
      currentBranch: "release",
      repoBranch: "release",
    })).toBe("main");
    expect(resolveThreadExecutionPath({}, "/home/autopr")).toBe("/home/autopr");
  });
});

describe("thread worktree provisioning decisions", () => {
  const porcelain = [
    "worktree /home/autopr",
    "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "branch refs/heads/main",
    "",
    "worktree /home/.autopr/worktrees/autopr/thread-1",
    "HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "branch refs/heads/autopr/fix-thread-1",
    "",
  ].join("\n");

  it("treats an already matching worktree as idempotently ready", () => {
    const entries = parseGitWorktreeList(porcelain);
    expect(entries).toHaveLength(2);
    expect(decideWorktreeProvision({
      entries,
      desiredPath: "/home/.autopr/worktrees/autopr/thread-1",
      featureBranch: "autopr/fix-thread-1",
      branchExists: true,
    })).toEqual({ kind: "ready", path: "/home/.autopr/worktrees/autopr/thread-1" });
  });

  it("recovers when a branch exists after an earlier worktree creation failure", () => {
    expect(decideWorktreeProvision({
      entries: [],
      desiredPath: "/home/.autopr/worktrees/autopr/thread-1",
      featureBranch: "autopr/fix-thread-1",
      branchExists: true,
    })).toEqual({
      kind: "create-from-existing-branch",
      path: "/home/.autopr/worktrees/autopr/thread-1",
    });
  });

  it("re-reads a completed worktree after a concurrent retry", () => {
    const before = decideWorktreeProvision({
      entries: [],
      desiredPath: "/home/.autopr/worktrees/autopr/thread-1",
      featureBranch: "autopr/fix-thread-1",
      branchExists: false,
    });
    const after = decideWorktreeProvision({
      entries: parseGitWorktreeList(porcelain),
      desiredPath: "/home/.autopr/worktrees/autopr/thread-1",
      featureBranch: "autopr/fix-thread-1",
      branchExists: true,
    });

    expect(before.kind).toBe("create-branch-and-worktree");
    expect(after.kind).toBe("ready");
  });

  it("refuses paths or branches owned by another worktree", () => {
    expect(decideWorktreeProvision({
      entries: parseGitWorktreeList(porcelain),
      desiredPath: "/home/.autopr/worktrees/autopr/thread-2",
      featureBranch: "autopr/fix-thread-1",
      branchExists: true,
    }).kind).toBe("conflict");
  });
});

describe("thread worktree cleanup safeguards", () => {
  it("removes only clean worktrees and always preserves the branch", () => {
    expect(assessWorktreeCleanup("\n")).toEqual({
      canRemoveWorktree: true,
      preserveBranch: true,
      reason: undefined,
    });
    expect(assessWorktreeCleanup(" M apps/web/src/app.tsx\n")).toMatchObject({
      canRemoveWorktree: false,
      preserveBranch: true,
    });
  });
});
