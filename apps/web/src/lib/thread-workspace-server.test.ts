import { describe, expect, it } from "vitest";

import { persistedThreadWorkspace, resolveThreadWorkspaceCoordinates, type PersistedThreadWorkspace } from "./thread-workspace-server";

const project = {
  cloneUrl: "https://github.com/acme/widget.git",
  repoName: "widget",
  sandboxWorkDir: "/home/widget",
  currentBranch: "main",
  defaultBranch: "main",
};

describe("persistedThreadWorkspace", () => {
  it("requires live branch inspection for checkout-mode workspaces", () => {
    expect(persistedThreadWorkspace(project, { workspaceMode: "checkout" })).toBeNull();
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

describe("resolveThreadWorkspaceCoordinates", () => {
  const liveWorkspace: PersistedThreadWorkspace = {
    workspaceMode: "checkout",
    baseBranch: "main",
    featureBranch: "fix/terminal-cwd",
    worktreePath: "/home/widget",
  };

  it("inspects checkout-mode threads live", async () => {
    let liveReads = 0;
    const workspace = await resolveThreadWorkspaceCoordinates(
      project,
      { workspaceMode: "checkout" },
      async () => {
        liveReads += 1;
        return liveWorkspace;
      },
    );

    expect(workspace).toEqual(liveWorkspace);
    expect(liveReads).toBe(1);
  });

  it("provisions pending worktrees through the live resolver", async () => {
    let liveReads = 0;
    await resolveThreadWorkspaceCoordinates(
      project,
      {
        workspaceMode: "worktree",
        worktreeStatus: "pending",
        baseBranch: "main",
        featureBranch: "autopr/pending",
        worktreePath: "/home/.autopr/worktrees/widget/pending",
      },
      async () => {
        liveReads += 1;
        return { ...liveWorkspace, workspaceMode: "worktree" };
      },
    );

    expect(liveReads).toBe(1);
  });

  it("does not re-resolve ready worktrees", async () => {
    let liveReads = 0;
    const workspace = await resolveThreadWorkspaceCoordinates(
      project,
      {
        workspaceMode: "worktree",
        worktreeStatus: "ready",
        baseBranch: "main",
        featureBranch: "autopr/ready",
        worktreePath: "/home/.autopr/worktrees/widget/ready",
      },
      async () => {
        liveReads += 1;
        return liveWorkspace;
      },
    );

    expect(workspace.featureBranch).toBe("autopr/ready");
    expect(liveReads).toBe(0);
  });
});
