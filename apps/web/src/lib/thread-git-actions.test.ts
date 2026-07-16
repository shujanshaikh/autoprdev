import type { ThreadGitStatus } from "@autopr/backend/convex/lib/gitStatus";
import { describe, expect, it } from "vitest";

import { resolveThreadGitActions } from "./thread-git-actions";

function status(overrides: Partial<ThreadGitStatus> = {}): ThreadGitStatus {
  return {
    isRepo: true,
    currentBranch: "autopr/iterative-work",
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
    aheadOfBaseCount: 1,
    diverged: false,
    localHeadSha: "local",
    remoteHeadSha: "remote",
    kind: "synchronized",
    checkedAt: 1,
    ...overrides,
  };
}

const pullRequest = {
  number: 42,
  title: "Iterative work",
  url: "https://github.com/acme/repo/pull/42",
  state: "open" as const,
  draft: false,
};

describe("resolveThreadGitActions", () => {
  it("commits, pushes, and creates a PR for new working changes", () => {
    const result = resolveThreadGitActions(status({ hasWorkingTreeChanges: true }));

    expect(result.primaryAction).toBe("create_pr");
    expect(result.primaryLabel).toBe("Commit, push & create PR");
    expect(result.actions.create_pr.enabled).toBe(true);
  });

  it("commits and pushes working changes to an existing PR branch", () => {
    const result = resolveThreadGitActions(status({ hasWorkingTreeChanges: true, pullRequest }));

    expect(result.primaryAction).toBe("commit_push");
    expect(result.actions.create_pr).toMatchObject({ enabled: false });
    expect(result.actions.create_pr.reason).toContain("#42");
  });

  it("pushes local commits that are ahead of the upstream", () => {
    const result = resolveThreadGitActions(status({ aheadCount: 2, kind: "ahead" }));

    expect(result.primaryAction).toBe("push");
    expect(result.actions.push.enabled).toBe(true);
  });

  it("pushes a local-only feature branch that has no upstream", () => {
    const result = resolveThreadGitActions(status({
      hasUpstream: false,
      aheadCount: null,
      behindCount: null,
      kind: "no_upstream",
    }));

    expect(result.primaryAction).toBe("push");
    expect(result.actions.push.enabled).toBe(true);
  });

  it("updates a clean branch that is behind", () => {
    const result = resolveThreadGitActions(status({ behindCount: 3, kind: "behind" }));

    expect(result.primaryAction).toBe("pull");
    expect(result.actions.pull.enabled).toBe(true);
  });

  it("explains why a dirty branch cannot be updated", () => {
    const result = resolveThreadGitActions(status({
      hasWorkingTreeChanges: true,
      behindCount: 1,
      kind: "uncommitted",
    }));

    expect(result.primaryAction).toBe("pull");
    expect(result.actions.pull).toMatchObject({ enabled: false });
    expect(result.actions.pull.reason).toContain("Commit or stash");
  });

  it("disables automation for a diverged branch", () => {
    const result = resolveThreadGitActions(status({
      aheadCount: 2,
      behindCount: 1,
      diverged: true,
      kind: "diverged",
      pullRequest,
    }));

    expect(result.primaryAction).toBeNull();
    expect(result.primaryReason).toContain("Merge or rebase");
    expect(result.actions.push.enabled).toBe(false);
    expect(result.actions.view_pr.enabled).toBe(true);
  });

  it("views an existing synchronized PR", () => {
    const result = resolveThreadGitActions(status({ pullRequest }));

    expect(result.primaryAction).toBe("view_pr");
    expect(result.actions.view_pr.enabled).toBe(true);
  });

  it("creates a PR for a clean synchronized branch that differs from base", () => {
    const result = resolveThreadGitActions(status({ aheadOfBaseCount: 4 }));

    expect(result.primaryAction).toBe("create_pr");
    expect(result.primaryLabel).toBe("Create PR");
  });

  it("has no primary mutation for a branch identical to base", () => {
    const result = resolveThreadGitActions(status({ aheadOfBaseCount: 0 }));

    expect(result.primaryAction).toBeNull();
    expect(result.primaryReason).toContain("does not differ from main");
    expect(result.actions.create_pr.enabled).toBe(false);
  });

  it("requires a named branch for detached HEAD", () => {
    const result = resolveThreadGitActions(status({
      currentBranch: undefined,
      detachedHead: true,
      kind: "detached",
    }));

    expect(result.primaryAction).toBeNull();
    expect(result.primaryLabel).toBe("Branch required");
    expect(result.actions.commit.reason).toContain("named branch");
  });

  it("keeps local commit available when no remote is configured", () => {
    const result = resolveThreadGitActions(status({
      hasWorkingTreeChanges: true,
      hasRemote: false,
      hasUpstream: false,
      remoteStatus: "not_configured",
      aheadCount: null,
      behindCount: null,
      kind: "no_remote",
    }));

    expect(result.actions.commit.enabled).toBe(true);
    expect(result.actions.commit_push.enabled).toBe(false);
    expect(result.actions.commit_push.reason).toContain("No Git remote");
  });

  it("reports remote refresh failures instead of treating them as synchronized", () => {
    const result = resolveThreadGitActions(status({
      hasWorkingTreeChanges: true,
      remoteStatus: "unavailable",
      remoteError: { code: "GIT_REMOTE_FETCH_FAILED", message: "GitHub could not be reached." },
      aheadCount: null,
      behindCount: null,
      diverged: null,
      kind: "remote_unavailable",
    }));

    expect(result.actions.commit.enabled).toBe(true);
    expect(result.actions.commit_push).toEqual({ enabled: false, reason: "GitHub could not be reached." });
  });

  it("returns specific loading and non-repository reasons", () => {
    expect(resolveThreadGitActions().primaryReason).toBe("Git status is still loading.");
    expect(resolveThreadGitActions(status({ isRepo: false, kind: "not_repository" })).primaryReason)
      .toBe("This workspace is not a Git repository.");
  });
});
