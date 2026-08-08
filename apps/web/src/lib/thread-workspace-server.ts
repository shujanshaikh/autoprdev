import { resolveThreadWorkspaceMode } from "@autopr/backend/convex/lib/threadWorktree";

export type PersistedThreadWorkspace = {
  workspaceMode: "checkout" | "worktree";
  baseBranch: string;
  featureBranch: string;
  worktreePath: string;
  headSha?: string;
  upstreamBranch?: string;
};

export type WorkspaceProject = {
  cloneUrl: string;
  repoName: string;
  sandboxWorkDir?: string;
  currentBranch?: string;
  repoBranch?: string;
  defaultBranch?: string;
};

export type WorkspaceThread = {
  workspaceMode?: "checkout" | "worktree";
  baseBranch?: string;
  featureBranch?: string;
  worktreePath?: string;
  worktreeStatus?: "pending" | "provisioning" | "ready" | "failed" | "cleaned";
  headSha?: string;
  upstreamBranch?: string;
};

/**
 * Returns workspace coordinates that are already durable in Convex.
 *
 * Passive reads and resumed operations should use these coordinates instead of
 * calling the provisioning action again. A null result means that a worktree
 * still needs the explicit resolve/provision path.
 */
export function persistedThreadWorkspace(
  _project: WorkspaceProject,
  thread: WorkspaceThread,
): PersistedThreadWorkspace | null {
  const workspaceMode = resolveThreadWorkspaceMode(thread);

  if (workspaceMode === "worktree") {
    if (
      (thread.worktreeStatus !== undefined && thread.worktreeStatus !== "ready")
      || !thread.baseBranch
      || !thread.featureBranch
      || !thread.worktreePath
    ) {
      return null;
    }

    return {
      workspaceMode,
      baseBranch: thread.baseBranch,
      featureBranch: thread.featureBranch,
      worktreePath: thread.worktreePath,
      headSha: thread.headSha,
      upstreamBranch: thread.upstreamBranch,
    };
  }

  // Checkout-mode branches can change through the terminal or another Git
  // client, so cached Convex metadata is not authoritative. Returning null
  // sends callers through resolveThreadWorkspace's live Git inspection.
  return null;
}

/**
 * Uses durable coordinates when they are authoritative and otherwise performs
 * the explicit live resolution required by checkout and pending-worktree modes.
 */
export function resolveThreadWorkspaceCoordinates(
  project: WorkspaceProject,
  thread: WorkspaceThread,
  resolveLive: () => Promise<PersistedThreadWorkspace>,
) {
  const persisted = persistedThreadWorkspace(project, thread);
  return persisted ? Promise.resolve(persisted) : resolveLive();
}
