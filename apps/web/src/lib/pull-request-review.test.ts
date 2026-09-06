import { describe, expect, it } from "vitest";
import { latestReviewerDecisions, pullRequestState } from "./pull-request-review";
import type { ProjectPullRequestTimelineItem } from "./project-pull-requests";

function review(state: string, day: number, login = "reviewer"): ProjectPullRequestTimelineItem {
  return { id: `${login}:${day}`, kind: "review", actor: { login }, createdAt: `2026-01-0${day}T00:00:00Z`, body: "", url: "https://github.com/review", state };
}

describe("review decisions", () => {
  it("keeps approvals when followed by a comment and excludes pending reviews", () => {
    expect(latestReviewerDecisions([review("pending", 3), review("commented", 2), review("approved", 1)]))
      .toEqual([review("approved", 1)]);
  });

  it("replaces an earlier decision with requested changes or dismissal", () => {
    const decisions = latestReviewerDecisions([
      review("approved", 1), review("changes_requested", 2),
      review("approved", 1, "maintainer"), review("dismissed", 2, "maintainer"),
    ]);
    expect(decisions.map((item) => item.state)).toEqual(["changes_requested", "dismissed"]);
  });

  it("treats reviewer logins case insensitively", () => {
    expect(latestReviewerDecisions([review("changes_requested", 1, "Reviewer"), review("approved", 2, "reviewer")]))
      .toEqual([review("approved", 2, "reviewer")]);
  });
});

it("distinguishes merged PRs and closed drafts from open drafts", () => {
  expect(pullRequestState({ state: "closed", draft: false, mergedAt: "2026-01-01" })).toBe("merged");
  expect(pullRequestState({ state: "closed", draft: true })).toBe("closed");
  expect(pullRequestState({ state: "open", draft: true })).toBe("draft");
});
