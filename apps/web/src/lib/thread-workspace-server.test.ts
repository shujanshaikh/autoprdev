import { describe, expect, it } from "vitest";

import { persistedThreadWorkspace } from "./thread-workspace-server";

const project = {
  cloneUrl: "https://github.com/acme/widget.git",
  repoName: "widget",
  sandboxWorkDir: "/home/widget",
  currentBranch: "main",
  defaultBranch: "main",
};

describe("persistedThreadWorkspace", () => {
  it("reuses checkout metadata without provisioning", () => {
    expect(persistedThreadWorkspace(project, { workspaceMode: "checkout" })).toEqual({
      workspaceMode: "checkout",
      baseBranch: "main",
      featureBranch: "main",
      worktreePath: "/home/widget",
      headSha: undefined,
      upstreamBranch: undefined,
    });
  });

  it("reuses a ready worktree", () => {
    expect(persistedThreadWorkspace(project, {
      workspaceMode: "worktree",
      worktreeStatus: "ready",
      baseBranch: "main",
      featureBranch: "autopr/fix-rate-limit",
      worktreePath: "/home/.autopr/worktrees/widget/fix-rate-limit",
      headSha: "abc123",
    })).toMatchObject({
      workspaceMode: "worktree",
      featureBranch: "autopr/fix-rate-limit",
      worktreePath: "/home/.autopr/worktrees/widget/fix-rate-limit",
    });
  });

  it("requires explicit provisioning for a pending worktree", () => {
    expect(persistedThreadWorkspace(project, {
      workspaceMode: "worktree",
      worktreeStatus: "pending",
      baseBranch: "main",
      featureBranch: "autopr/new-thread",
      worktreePath: "/home/.autopr/worktrees/widget/new-thread",
    })).toBeNull();
  });
});
