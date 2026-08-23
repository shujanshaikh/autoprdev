import type { ThreadGitStatus } from "@autopr/backend/convex/lib/gitStatus";

/**
 * Git action availability, ported from the web thread's commit button
 * (`apps/web/src/lib/thread-git-actions.ts`) so both surfaces offer the same
 * actions, with the same guard rails, off the same status document.
 */

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

export type ThreadGitActionAvailability = {
  enabled: boolean;
  reason?: string;
};

export type ThreadGitActionResolution = {
  primaryAction: ThreadGitAction | null;
  primaryLabel: string;
  primaryReason?: string;
  actions: Record<ThreadGitAction, ThreadGitActionAvailability>;
};

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

/** Actions that run through the phased Git workflow rather than a direct call. */
export function isGitWorkflowAction(action: ThreadGitAction) {
  return action !== "pull" && action !== "view_pr";
}

export function createsPullRequest(action: ThreadGitAction) {
  return action === "create_pr"
    || action === "push_create_pr"
    || action === "commit_push_create_pr";
}

const disabled = (reason: string): ThreadGitActionAvailability => ({ enabled: false, reason });
const enabled = (): ThreadGitActionAvailability => ({ enabled: true });

function allDisabled(reason: string): Record<ThreadGitAction, ThreadGitActionAvailability> {
  return /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ Object.fromEntries(
    threadGitActions.map((action) => [action, disabled(reason)]),
  ) as Record<ThreadGitAction, ThreadGitActionAvailability>;
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
  const existingPullRequestReason = `Pull request #${pullRequest?.number ?? ""} already exists for this branch.`
    .replace("# ", "");
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
    ? disabled(existingPullRequestReason)
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
    ? disabled(existingPullRequestReason)
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
    ? disabled(existingPullRequestReason)
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

/* ─── Overview rows ─────────────────────────────────────────────────── */

export type GitOverviewRow = "commit" | "push" | "pr" | "pull";

/**
 * The action a row runs. "Create PR" folds in the push the web does for an
 * unpushed branch, so one row covers both create_pr and push_create_pr.
 */
export function rowAction(
  row: GitOverviewRow,
  resolution: ThreadGitActionResolution,
): ThreadGitAction {
  if (row === "commit") return "commit";
  if (row === "push") return "push";
  if (row === "pull") return "pull";
  if (resolution.actions.view_pr.enabled) return "view_pr";
  return resolution.actions.create_pr.enabled ? "create_pr" : "push_create_pr";
}

export function rowLabel(row: GitOverviewRow, resolution: ThreadGitActionResolution) {
  const action = rowAction(row, resolution);
  if (row === "pr") return action === "view_pr" ? "View PR" : "Create PR";
  return threadGitActionLabels[action];
}

function fileCountLabel(count: number) {
  return `${count} file${count === 1 ? "" : "s"} changed`;
}

function commitCountLabel(count: number, direction: "ahead" | "behind") {
  return `${count} commit${count === 1 ? "" : "s"} ${direction}`;
}

/**
 * The status fact a row carries when it is enabled. Facts live on the row they
 * belong to rather than crowding the header, matching the T3 Code sheet.
 */
export function rowDetail(row: GitOverviewRow, status?: ThreadGitStatus | null) {
  if (!status) return undefined;
  if (row === "commit" && status.hasWorkingTreeChanges) {
    return fileCountLabel(status.changedFiles.length);
  }
  if (row === "push" && (status.aheadCount ?? 0) > 0) {
    return commitCountLabel(status.aheadCount ?? 0, "ahead");
  }
  if (row === "pull" && (status.behindCount ?? 0) > 0) {
    return commitCountLabel(status.behindCount ?? 0, "behind");
  }
  if (row === "pr" && status.pullRequest) {
    return `PR #${status.pullRequest.number} ${status.pullRequest.state}`;
  }
  return undefined;
}

/** One-line branch summary shown under the branch name. */
export function gitStatusSummary(status?: ThreadGitStatus | null) {
  if (!status) return "Checking status…";
  if (!status.isRepo) return "Not a Git repository";

  const parts: string[] = [
    status.hasWorkingTreeChanges ? fileCountLabel(status.changedFiles.length) : "Clean",
  ];
  if ((status.aheadCount ?? 0) > 0) parts.push(`${status.aheadCount} ahead`);
  if ((status.behindCount ?? 0) > 0) parts.push(`${status.behindCount} behind`);
  if (status.pullRequest?.state === "open") parts.push(`PR #${status.pullRequest.number} open`);
  return parts.join(" · ");
}

export function changedFileTotals(status?: ThreadGitStatus | null) {
  return (status?.changedFiles ?? []).reduce(
    (totals, file) => ({
      additions: totals.additions + (file.additions ?? 0),
      deletions: totals.deletions + (file.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  );
}

export function createOperationId() {
  if (globalThis.crypto?.randomUUID instanceof Function) {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
