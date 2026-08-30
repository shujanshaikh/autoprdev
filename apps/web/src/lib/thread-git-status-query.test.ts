import type { ThreadGitStatus } from "@autopr/backend/convex/lib/gitStatus";
import { describe, expect, it } from "vitest";

import { resolveThreadBranchLabel } from "./thread-git-status-query";

function status(overrides: Partial<ThreadGitStatus> = {}): ThreadGitStatus {
  return {
    isRepo: true,
    currentBranch: "autopr/new-thread-123",
    detachedHead: false,
    baseBranch: "main",
    hasWorkingTreeChanges: false,
    changedFiles: [],
    changedFilesTruncated: false,
    hasRemote: true,
    hasUpstream: false,
    remoteStatus: "available",
    aheadCount: null,
    behindCount: null,
    aheadOfBaseCount: 0,
    diverged: false,
    localHeadSha: "1234567890",
    kind: "no_upstream",
    checkedAt: 10,
    ...overrides,
  };
}

describe("composer branch label", () => {
  it("shows the renamed worktree branch as soon as Convex invalidates the old status", () => {
    expect(resolveThreadBranchLabel({
      status: status(),
      expectedBranch: "autopr/summarize-latest-changes-2",
      invalidatedAt: 11,
    })).toBe("autopr/summarize-latest-changes-2");
  });

  it("uses the refreshed Daytona branch once Git status catches up", () => {
    expect(resolveThreadBranchLabel({
      status: status({
        currentBranch: "autopr/summarize-latest-changes-2",
        checkedAt: 12,
      }),
      expectedBranch: "autopr/summarize-latest-changes-2",
      invalidatedAt: 11,
    })).toBe("autopr/summarize-latest-changes-2");
  });

  it("keeps the last verified branch when the refresh fails", () => {
    expect(resolveThreadBranchLabel({
      status: status(),
      expectedBranch: "autopr/summarize-latest-changes-2",
      invalidatedAt: 11,
      readFailed: true,
    })).toBe("autopr/new-thread-123");
  });
});
