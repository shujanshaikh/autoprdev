import { describe, expect, it } from "vitest";
import { createThreadFeatureBranch } from "@autopr/backend/convex/lib/threadWorktree";

import {
  persistedTemporaryThreadWorkspace,
  persistedThreadWorkspace,
  resolveThreadWorkspaceCoordinates,
  type PersistedThreadWorkspace,
} from "./thread-workspace-server";

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

describe("persistedTemporaryThreadWorkspace", () => {
  const threadId = "thread-1";
  const featureBranch = createThreadFeatureBranch("New thread", threadId);
  const worktree = {
    workspaceMode: "worktree" as const,
    baseBranch: "main",
    featureBranch,
    worktreePath: "/home/.autopr/worktrees/widget/thread-1",
    headSha: "abc123",
  };

  it("never lets metadata generation provision or join a pending worktree", () => {
    expect(persistedTemporaryThreadWorkspace(project, {
      ...worktree,
      worktreeStatus: "pending",
    }, threadId)).toBeNull();
    expect(persistedTemporaryThreadWorkspace(project, {
      ...worktree,
      worktreeStatus: "provisioning",
    }, threadId)).toBeNull();
  });

  it("returns only a ready provisional worktree", () => {
    expect(persistedTemporaryThreadWorkspace(project, {
      ...worktree,
      worktreeStatus: "ready",
    }, threadId)).toMatchObject({ featureBranch });
    expect(persistedTemporaryThreadWorkspace(project, {
      ...worktree,
      featureBranch: "autopr/fix-worktree-startup",
      worktreeStatus: "ready",
    }, threadId)).toBeNull();
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
