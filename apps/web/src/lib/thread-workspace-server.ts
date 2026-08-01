import {
  DEFAULT_SANDBOX_WORKDIR,
  sandboxRepositoryDirectoryName,
  sandboxRepositoryPath,
} from "@autopr/agent/sandbox";
import { resolveThreadWorkspaceMode } from "@autopr/backend/convex/lib/threadWorktree";

export type PersistedThreadWorkspace = {
  workspaceMode: "checkout" | "worktree";
  baseBranch: string;
  featureBranch: string;
  worktreePath: string;
  headSha?: string;
  upstreamBranch?: string;
};

type WorkspaceProject = {
  cloneUrl: string;
  repoName: string;
  sandboxWorkDir?: string;
  currentBranch?: string;
  repoBranch?: string;
  defaultBranch?: string;
};

type WorkspaceThread = {
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
  project: WorkspaceProject,
  thread: WorkspaceThread,
): PersistedThreadWorkspace | null {
  const workspaceMode = resolveThreadWorkspaceMode(thread);
  const repositoryPath = project.sandboxWorkDir ?? sandboxRepositoryPath(
    DEFAULT_SANDBOX_WORKDIR,
    sandboxRepositoryDirectoryName({ repoName: project.repoName, repoUrl: project.cloneUrl }),
  );

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

  const featureBranch = project.currentBranch
    ?? project.repoBranch
    ?? thread.baseBranch
    ?? project.defaultBranch;
  if (!featureBranch) return null;

  return {
    workspaceMode,
    baseBranch: project.defaultBranch ?? thread.baseBranch ?? featureBranch,
    featureBranch,
    worktreePath: repositoryPath,
    headSha: thread.headSha,
    upstreamBranch: thread.upstreamBranch,
  };
}
