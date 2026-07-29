import { describe, expect, it } from "vitest";

import {
  createPullRequestFallback,
  normalizeGeneratedCommitMessage,
  normalizeGeneratedThreadTitle,
} from "./generated-git-metadata";

describe("generated Git metadata", () => {
  it("normalizes concise generated thread titles and bounds fallback prompts", () => {
    expect(normalizeGeneratedThreadTitle('"Improve Git workflow."', "ignored"))
      .toBe("Improve Git workflow");
    expect(normalizeGeneratedThreadTitle(
      "",
      "I want you to improve the pull request body and branch naming behavior for this project",
    )).toBe("improve the pull request body and branch naming");
  });

  it("keeps commit subjects on one safe line", () => {
    expect(normalizeGeneratedCommitMessage("Subject: Improve PR metadata.\nExtra explanation"))
      .toBe("Improve PR metadata");
  });

  it("creates useful PR content without leaking internal thread IDs", () => {
    const pullRequest = createPullRequestFallback({
      headBranch: "autopr/improve-git-workflow",
      commitSummary: "abc1234 Improve Git workflow metadata\ndef5678 Add title generation",
      diffSummary: "3 files changed, 42 insertions(+)",
    });

    expect(pullRequest.title).toBe("Improve Git workflow metadata");
    expect(pullRequest.body).toContain("## Summary");
    expect(pullRequest.body).toContain("- Improve Git workflow metadata");
    expect(pullRequest.body).toContain("## Testing");
    expect(pullRequest.body).not.toContain("AutoPR thread");
  });
});
