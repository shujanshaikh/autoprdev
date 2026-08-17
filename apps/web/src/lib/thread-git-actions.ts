import type { ThreadGitStatus } from "@autopr/backend/convex/lib/gitStatus";

export const threadGitActions = [
  "commit",
  "push",
  "create_pr",
  "commit_push",
  "push_create_pr",
  "commit_push_create_pr",
  "pull",
  "view_pr",
] as const;

export type ThreadGitAction = (typeof threadGitActions)[number];

export interface ThreadGitActionAvailability {
  enabled: boolean;
  reason?: string;
}

export interface ThreadGitActionResolution {
  primaryAction: ThreadGitAction | null;
  primaryLabel: string;
  primaryReason?: string;
  actions: Record<ThreadGitAction, ThreadGitActionAvailability>;
}

export const threadGitActionLabels = {
  commit: "Commit",
  commit_push: "Commit & push",
  push: "Push",
  create_pr: "Create PR",
  push_create_pr: "Push & create PR",
  commit_push_create_pr: "Commit, push & create PR",
  pull: "Update branch",
  view_pr: "View PR",
} satisfies Record<ThreadGitAction, string>;

const disabled = (reason: string): ThreadGitActionAvailability => ({ enabled: false, reason });
const enabled = (): ThreadGitActionAvailability => ({ enabled: true });

function allDisabled(reason: string): Record<ThreadGitAction, ThreadGitActionAvailability> {
  return /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ Object.fromEntries(threadGitActions.map((action) => [action, disabled(reason)])) as Record<
    ThreadGitAction,
    ThreadGitActionAvailability
  >;
}

function unavailableResolution(label: string, reason: string): ThreadGitActionResolution {
  return {
    primaryAction: null,
    primaryLabel: label,
    primaryReason: reason,
    actions: allDisabled(reason),
  };
}

export function resolveThreadGitActions(status?: ThreadGitStatus | null): ThreadGitActionResolution {
  if (!status) {
    return unavailableResolution("Checking Git…", "Git status is still loading.");
  }

  if (!status.isRepo) {
    return unavailableResolution("Git unavailable", "This workspace is not a Git repository.");
  }

  const pullRequest = status.pullRequest;
  const hasPullRequest = Boolean(pullRequest?.url);
  const ahead = status.aheadCount ?? 0;
  const behind = status.behindCount ?? 0;
  const aheadOfBase = status.aheadOfBaseCount ?? 0;
  const hasLocalCommits = ahead > 0 || (!status.hasUpstream && aheadOfBase > 0);
  const differsFromBase = status.hasWorkingTreeChanges || aheadOfBase > 0;
  const remoteUnavailable = !status.hasRemote || status.remoteStatus === "unavailable";
  const remoteReason = !status.hasRemote
    ? "No Git remote is configured for this branch."
    : status.remoteError?.message || "The Git remote is currently unavailable.";
  const actions = allDisabled("This action is not available for the current Git state.");

  actions.view_pr = hasPullRequest
    ? enabled()
    : disabled("No pull request exists for this branch yet.");

  if (status.detachedHead || !status.currentBranch) {
    const reason = "A named branch is required before Git changes can be committed, pushed, or opened as a PR.";
    for (const action of threadGitActions) {
      if (action !== "view_pr") actions[action] = disabled(reason);
    }
    return {
      primaryAction: null,
      primaryLabel: "Branch required",
      primaryReason: reason,
      actions,
    };
  }

  if (status.diverged === true || (ahead > 0 && behind > 0)) {
    const reason = "The local and remote branches have diverged. Merge or rebase them manually before continuing.";
    for (const action of threadGitActions) {
      if (action !== "view_pr") actions[action] = disabled(reason);
    }
    return {
      primaryAction: null,
      primaryLabel: "Resolve divergence",
      primaryReason: reason,
      actions,
    };
  }

  const behindReason = status.hasWorkingTreeChanges
    ? "Commit or stash the working-tree changes before updating the branch."
    : "The branch is not behind its upstream.";

  actions.commit = status.hasWorkingTreeChanges
    ? behind > 0
      ? disabled("Update the branch before creating another local commit.")
      : enabled()
    : disabled("There are no working-tree changes to commit.");

  actions.commit_push = status.hasWorkingTreeChanges
    ? behind > 0
      ? disabled("Update the branch before committing and pushing.")
      : remoteUnavailable
        ? disabled(remoteReason)
        : enabled()
    : disabled("There are no working-tree changes to commit.");

  actions.commit_push_create_pr = hasPullRequest
    ? disabled(`Pull request #${pullRequest?.number ?? ""} already exists for this branch.`.replace("# ", ""))
    : status.hasWorkingTreeChanges
      ? behind > 0
        ? disabled("Update the branch before committing, pushing, and creating a pull request.")
        : remoteUnavailable
          ? disabled(remoteReason)
          : enabled()
      : disabled("There are no working-tree changes to commit.");

  actions.push = hasLocalCommits
    ? behind > 0
      ? disabled("Update the branch before pushing local commits.")
      : remoteUnavailable
        ? disabled(remoteReason)
        : enabled()
    : disabled("There are no local commits to push.");

  actions.push_create_pr = hasPullRequest
    ? disabled(`Pull request #${pullRequest?.number ?? ""} already exists for this branch.`.replace("# ", ""))
    : hasLocalCommits
      ? behind > 0
        ? disabled("Update the branch before pushing and creating a pull request.")
        : remoteUnavailable
          ? disabled(remoteReason)
          : enabled()
      : disabled("There are no local commits to push.");

  actions.pull = behind > 0
    ? status.hasWorkingTreeChanges
      ? disabled(behindReason)
      : !status.hasUpstream
        ? disabled("This branch has no upstream branch to update from.")
        : remoteUnavailable
          ? disabled(remoteReason)
          : enabled()
    : disabled(behindReason);

  const branchIsPushed = Boolean(status.remoteHeadSha && status.remoteHeadSha === status.localHeadSha);
  actions.create_pr = hasPullRequest
    ? disabled(`Pull request #${pullRequest?.number ?? ""} already exists for this branch.`.replace("# ", ""))
    : status.hasWorkingTreeChanges
      ? disabled("Commit and push the working-tree changes before creating a pull request.")
      : hasLocalCommits || !branchIsPushed
        ? disabled("Push the current commit before creating a pull request.")
        : !differsFromBase
          ? disabled(`This branch does not differ from ${status.baseBranch}.`)
          : behind > 0
            ? disabled("Update the branch before creating a pull request.")
            : remoteUnavailable
              ? disabled(remoteReason)
              : enabled();

  if (behind > 0) {
    return {
      primaryAction: "pull",
      primaryLabel: "Update branch",
      primaryReason: actions.pull.reason,
      actions,
    };
  }

  if (status.hasWorkingTreeChanges) {
    const primaryAction = hasPullRequest ? "commit_push" : "commit_push_create_pr";
    return {
      primaryAction,
      primaryLabel: hasPullRequest ? "Commit & push" : "Commit, push & create PR",
      primaryReason: actions[primaryAction].reason,
      actions,
    };
  }

  if (hasLocalCommits) {
    const primaryAction = hasPullRequest ? "push" : "push_create_pr";
    return {
      primaryAction,
      primaryLabel: hasPullRequest ? "Push" : "Push & create PR",
      primaryReason: actions[primaryAction].reason,
      actions,
    };
  }

  if (hasPullRequest) {
    return {
      primaryAction: "view_pr",
      primaryLabel: "View PR",
      actions,
    };
  }

  if (aheadOfBase > 0) {
    return {
      primaryAction: "create_pr",
      primaryLabel: "Create PR",
      primaryReason: actions.create_pr.reason,
      actions,
    };
  }

  const reason = `This branch is synchronized and does not differ from ${status.baseBranch}.`;
  return {
    primaryAction: null,
    primaryLabel: "No Git changes",
    primaryReason: reason,
    actions,
  };
}
