export interface ThreadBranchMetadata {
  workspaceMode?: ThreadWorkspaceMode;
  baseBranch?: string;
  featureBranch?: string;
  worktreePath?: string;
}

export type ThreadWorkspaceMode = "checkout" | "worktree";

export interface ProjectBranchMetadata {
  currentBranch?: string;
  repoBranch?: string;
  defaultBranch?: string;
}

export interface GitWorktreeEntry {
  path: string;
  branch?: string;
  headSha?: string;
}

const MAX_BRANCH_LENGTH = 120;
const MAX_SLUG_LENGTH = 72;

function safeIdentifier(value: string, fallback: string) {
  const normalized = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");

  return normalized || fallback;
}

export function createThreadFeatureBranch(title: string, threadId: string) {
  const slug = safeIdentifier(title, "thread");
  const suffix = safeIdentifier(threadId, "thread").replace(/^thread-/, "").slice(-10) || "thread";
  const availableSlugLength = Math.max(1, MAX_BRANCH_LENGTH - "autopr//-".length - suffix.length);
  const trimmedSlug = slug.slice(0, availableSlugLength).replace(/-+$/g, "") || "thread";
  return `autopr/${trimmedSlug}-${suffix}`;
}

/** Create a short, valid branch from model- or user-supplied semantic text. */
export function createSemanticFeatureBranch(value: string) {
  const withoutRefPrefix = value
    .trim()
    .replace(/^refs\/heads\//i, "")
    .replace(/^(?:autopr|feature|feat|fix|chore)\//i, "");
  const slug = safeIdentifier(withoutRefPrefix, "project-changes");
  const availableSlugLength = MAX_BRANCH_LENGTH - "autopr/".length;
  return `autopr/${slug.slice(0, availableSlugLength).replace(/-+$/g, "") || "project-changes"}`;
}

/**
 * Keep generated feature branches stable while avoiding an existing local ref.
 * Git refs are case-sensitive on some filesystems and case-insensitive on
 * others, so collision checks deliberately normalize case.
 */
export function resolveAvailableThreadFeatureBranch(
  preferredBranch: string,
  existingBranches: readonly string[],
) {
  const existing = new Set(existingBranches.map((branch) => branch.trim().toLowerCase()));
  if (!existing.has(preferredBranch.toLowerCase())) return preferredBranch;

  for (let suffix = 2; suffix <= existing.size + 2; suffix += 1) {
    const suffixText = `-${suffix}`;
    const candidate = `${preferredBranch.slice(0, MAX_BRANCH_LENGTH - suffixText.length)
      .replace(/-+$/g, "")}${suffixText}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }

  // The loop always finds a gap in a finite set (pigeonhole principle).
  throw new Error("Could not resolve an available feature branch name.");
}

export function parseGitRemoteHeadNames(output: string) {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^[0-9a-f]+\s+refs\/heads\/(.+)$/i);
    return match?.[1] ? [match[1]] : [];
  });
}

export function resolveThreadBaseBranch(
  thread: Pick<ThreadBranchMetadata, "baseBranch">,
  project: ProjectBranchMetadata,
) {
  return thread.baseBranch ?? project.currentBranch ?? project.repoBranch ?? project.defaultBranch;
}

function pathSegment(value: string, fallback: string) {
  return safeIdentifier(value, fallback).slice(0, 80);
}

export function createThreadWorktreePath(
  repositoryPath: string,
  repoName: string,
  threadId: string,
) {
  const normalizedRepositoryPath = repositoryPath.replace(/\/+$/, "");
  const lastSlash = normalizedRepositoryPath.lastIndexOf("/");
  const sandboxDirectory = lastSlash > 0 ? normalizedRepositoryPath.slice(0, lastSlash) : "/home";
  return `${sandboxDirectory}/.autopr/worktrees/${pathSegment(repoName, "repository")}/${pathSegment(threadId, "thread")}`;
}

export function resolveThreadExecutionPath(
  thread: Pick<ThreadBranchMetadata, "workspaceMode" | "featureBranch" | "worktreePath">,
  projectRepositoryPath: string,
) {
  return resolveThreadWorkspaceMode(thread) === "worktree"
    ? thread.worktreePath?.trim() || projectRepositoryPath
    : projectRepositoryPath;
}

export function resolveThreadWorkspaceMode(
  thread: Pick<ThreadBranchMetadata, "workspaceMode" | "featureBranch" | "worktreePath">,
): ThreadWorkspaceMode {
  if (thread.workspaceMode) return thread.workspaceMode;

  // Threads created before workspaceMode was persisted were worktree-backed
  // whenever branch/worktree metadata was allocated. Truly metadata-less
  // legacy threads retain the original shared-checkout behavior.
  return thread.featureBranch?.trim() || thread.worktreePath?.trim()
    ? "worktree"
    : "checkout";
}

export function parseGitWorktreeList(output: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let current: GitWorktreeEntry | undefined;

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: line.slice("worktree ".length) };
    } else if (current && line.startsWith("HEAD ")) {
      current.headSha = line.slice("HEAD ".length);
    } else if (current && line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    } else if (!line && current) {
      entries.push(current);
      current = undefined;
    }
  }

  if (current) entries.push(current);
  return entries;
}

export type WorktreeProvisionDecision =
  | { kind: "ready"; path: string }
  | { kind: "create-from-existing-branch"; path: string }
  | { kind: "create-branch-and-worktree"; path: string }
  | { kind: "conflict"; message: string };

export function decideWorktreeProvision(options: {
  entries: GitWorktreeEntry[];
  desiredPath: string;
  featureBranch: string;
  branchExists: boolean;
}): WorktreeProvisionDecision {
  const atPath = options.entries.find((entry) => entry.path === options.desiredPath);
  if (atPath) {
    return atPath.branch === options.featureBranch
      ? { kind: "ready", path: atPath.path }
      : {
          kind: "conflict",
          message: `The thread worktree path is already attached to ${atPath.branch ?? "a detached checkout"}.`,
        };
  }

  const forBranch = options.entries.find((entry) => entry.branch === options.featureBranch);
  if (forBranch) {
    return {
      kind: "conflict",
      message: `The thread branch is already attached to a different worktree at ${forBranch.path}.`,
    };
  }

  return options.branchExists
    ? { kind: "create-from-existing-branch", path: options.desiredPath }
    : { kind: "create-branch-and-worktree", path: options.desiredPath };
}

export function assessWorktreeCleanup(statusPorcelain: string) {
  const hasUncommittedChanges = statusPorcelain.trim().length > 0;
  return {
    canRemoveWorktree: !hasUncommittedChanges,
    preserveBranch: true as const,
    reason: hasUncommittedChanges
      ? "The thread worktree has uncommitted changes. Commit or discard them before deleting the thread."
      : undefined,
  };
}
