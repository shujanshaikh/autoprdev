import type { ThreadGitStatus } from "@autopr/backend/convex/lib/gitStatus";
import { describe, expect, it } from "vitest";

import { gitStatusSummary, resolveThreadGitActions, rowAction, rowDetail, rowLabel } from "./gitActions";

function status(overrides: Partial<ThreadGitStatus> = {}): ThreadGitStatus {
  return {
    isRepo: true,
    currentBranch: "feat/mobile",
    detachedHead: false,
    baseBranch: "main",
    hasWorkingTreeChanges: false,
    changedFiles: [],
    changedFilesTruncated: false,
    hasRemote: true,
    hasUpstream: true,
    remoteStatus: "available",
    aheadCount: 0,
    behindCount: 0,
    aheadOfBaseCount: 0,
    diverged: false,
    kind: "synchronized",
    checkedAt: 0,
    ...overrides,
  };
}

const changedFile = (path: string) => ({
  path,
  indexStatus: " ",
  workingTreeStatus: "M",
  additions: 3,
  deletions: 1,
});

describe("resolveThreadGitActions", () => {
  it("leads with the full ship action when a dirty branch has no pull request", () => {
    const resolution = resolveThreadGitActions(status({
      hasWorkingTreeChanges: true,
      changedFiles: [changedFile("src/a.ts")],
      aheadOfBaseCount: 1,
    }));

    expect(resolution.primaryAction).toBe("commit_push_create_pr");
    expect(resolution.actions.commit.enabled).toBe(true);
    expect(resolution.actions.push.enabled).toBe(false);
    expect(resolution.actions.push.reason).toBe("There are no local commits to push.");
  });

  it("drops the pull request step once one is already open", () => {
    const resolution = resolveThreadGitActions(status({
      hasWorkingTreeChanges: true,
      changedFiles: [changedFile("src/a.ts")],
      pullRequest: {
        number: 12,
        title: "Improve mobile",
        url: "https://github.com/o/r/pull/12",
        state: "open",
        draft: false,
      },
    }));

    expect(resolution.primaryAction).toBe("commit_push");
    expect(resolution.actions.commit_push_create_pr.enabled).toBe(false);
    expect(resolution.actions.view_pr.enabled).toBe(true);
  });

  it("prefers updating a branch that is behind its upstream", () => {
    const resolution = resolveThreadGitActions(status({ behindCount: 2 }));

    expect(resolution.primaryAction).toBe("pull");
    expect(resolution.actions.pull.enabled).toBe(true);
  });

  it("blocks every write action on a diverged branch", () => {
    const resolution = resolveThreadGitActions(status({ aheadCount: 1, behindCount: 1 }));

    expect(resolution.primaryAction).toBeNull();
    expect(resolution.actions.commit.enabled).toBe(false);
    expect(resolution.actions.push.enabled).toBe(false);
    expect(resolution.actions.create_pr.enabled).toBe(false);
  });

  it("requires a named branch before anything can be shipped", () => {
    const resolution = resolveThreadGitActions(status({
      detachedHead: true,
      currentBranch: undefined,
    }));

    expect(resolution.primaryLabel).toBe("Branch required");
    expect(resolution.actions.commit.reason).toContain("named branch is required");
  });

  it("reports an unavailable remote rather than offering a doomed push", () => {
    const resolution = resolveThreadGitActions(status({
      aheadCount: 1,
      remoteStatus: "unavailable",
      remoteError: { code: "NETWORK", message: "GitHub is unreachable." },
    }));

    expect(resolution.actions.push.enabled).toBe(false);
    expect(resolution.actions.push.reason).toBe("GitHub is unreachable.");
  });

  it("treats a missing status as still loading", () => {
    expect(resolveThreadGitActions(undefined).primaryLabel).toBe("Checking Git…");
    expect(resolveThreadGitActions(status({ isRepo: false })).primaryLabel).toBe("Git unavailable");
  });
});

describe("overview rows", () => {
  it("folds the push into Create PR while the branch is unpushed", () => {
    const resolution = resolveThreadGitActions(status({ aheadCount: 2, aheadOfBaseCount: 2 }));

    expect(rowAction("pr", resolution)).toBe("push_create_pr");
    expect(rowLabel("pr", resolution)).toBe("Create PR");
    expect(resolution.actions.push_create_pr.enabled).toBe(true);
  });

  it("opens an existing pull request instead of creating another", () => {
    const resolution = resolveThreadGitActions(status({
      pullRequest: {
        number: 7,
        title: "Ship it",
        url: "https://github.com/o/r/pull/7",
        state: "open",
        draft: false,
      },
    }));

    expect(rowAction("pr", resolution)).toBe("view_pr");
    expect(rowLabel("pr", resolution)).toBe("View PR");
  });

  it("puts each status fact on the row it belongs to", () => {
    const dirty = status({
      hasWorkingTreeChanges: true,
      changedFiles: [changedFile("a.ts"), changedFile("b.ts")],
    });

    expect(rowDetail("commit", dirty)).toBe("2 files changed");
    expect(rowDetail("push", status({ aheadCount: 1 }))).toBe("1 commit ahead");
    expect(rowDetail("pull", status({ behindCount: 3 }))).toBe("3 commits behind");
    expect(rowDetail("commit", status())).toBeUndefined();
  });
});

describe("gitStatusSummary", () => {
  it("summarizes a clean branch", () => {
    expect(gitStatusSummary(status())).toBe("Clean");
  });

  it("chains the facts a branch is carrying", () => {
    expect(gitStatusSummary(status({
      hasWorkingTreeChanges: true,
      changedFiles: [changedFile("a.ts")],
      aheadCount: 2,
      pullRequest: {
        number: 4,
        title: "t",
        url: "u",
        state: "open",
        draft: false,
      },
    }))).toBe("1 file changed · 2 ahead · PR #4 open");
  });

  it("says so when the workspace is not a repository", () => {
    expect(gitStatusSummary(status({ isRepo: false }))).toBe("Not a Git repository");
    expect(gitStatusSummary(undefined)).toBe("Checking status…");
  });
});
