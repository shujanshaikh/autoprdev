import type { ProjectPullRequest, ProjectPullRequestTimelineItem } from "./project-pull-requests";

export function pullRequestState(pull: Pick<ProjectPullRequest, "state" | "draft" | "mergedAt">) {
  if (pull.mergedAt) return "merged";
  if (pull.state === "closed") return "closed";
  return pull.draft ? "draft" : "open";
}

/** A later comment does not revoke an approval or a request for changes. */
export function latestReviewerDecisions(timeline: readonly ProjectPullRequestTimelineItem[]) {
  const decisions = new Map<string, Extract<ProjectPullRequestTimelineItem, { body: string }>>();
  for (const item of [...timeline].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (item.kind !== "review" || item.state === "pending") continue;
    const login = item.actor.login.toLowerCase();
    const previous = decisions.get(login);
    if (item.state === "commented" && previous && previous.state !== "commented") continue;
    decisions.set(login, item);
  }
  return [...decisions.values()];
}

export function reviewDecisionLabel(state?: string) {
  if (state === "approved") return "Approved";
  if (state === "changes_requested") return "Changes requested";
  if (state === "dismissed") return "Review dismissed";
  return "Commented";
}
