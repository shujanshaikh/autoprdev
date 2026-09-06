import { afterEach, describe, expect, it, vi } from "vitest";

import {
  githubPullRequestLocalBranch,
  githubRepositoriesMatch,
  isThreadCompatibleWithGithubPullRequest,
  parseGithubPullRequestReference,
  resolveGithubPullRequestHead,
} from "@autopr/backend/convex/lib/githubPullRequest";
import {
  fetchGithubPullRequestDetail,
  fetchGithubPullRequestChecks,
  fetchGithubPullRequests,
  fetchGithubPullRequestFiles,
  fetchGithubPullRequestForBranch,
  fetchGithubPullRequestTimeline,
  GithubApiError,
  resolveGithubPullRequest,
} from "@autopr/backend/convex/lib/github_oauth";

describe("parseGithubPullRequestReference", () => {
  it.each([
    ["https://github.com/Acme/Widget/pull/123", { number: 123, owner: "Acme", repo: "Widget" }],
    ["#123", { number: 123 }],
    ["123", { number: 123 }],
    ["gh pr checkout 123", { number: 123 }],
    ["gh pr checkout #123", { number: 123 }],
    ["gh pr checkout https://github.com/acme/widget/pull/123", { number: 123, owner: "acme", repo: "widget" }],
    ["gh pr checkout 123 --repo acme/widget", { number: 123, owner: "acme", repo: "widget" }],
    ["gh pr checkout --repo acme/widget 123", { number: 123, owner: "acme", repo: "widget" }],
    ["gh pr checkout 123 -R acme/widget", { number: 123, owner: "acme", repo: "widget" }],
    ["gh pr checkout 123 --repo=acme/widget", { number: 123, owner: "acme", repo: "widget" }],
    ["gh pr checkout --branch local-review 123 -R acme/widget", { number: 123, owner: "acme", repo: "widget" }],
  ])("parses %s", (input, expected) => {
    expect(parseGithubPullRequestReference(input)).toEqual(expected);
  });

  it.each(["", "#0", "-1", "github.com/acme/widget/pull/1", "gh pr checkout", "gh pr checkout branch-name"])(
    "rejects invalid reference %s",
    (input) => expect(() => parseGithubPullRequestReference(input)).toThrow(),
  );

  it("rejects conflicting URL and --repo repositories", () => {
    expect(() => parseGithubPullRequestReference(
      "gh pr checkout https://github.com/acme/widget/pull/12 --repo other/widget",
    )).toThrow(/different repositories/);
  });

  it("creates a stable SHA-specific local branch", () => {
    expect(githubPullRequestLocalBranch(42, "ABCDEF1234567890")).toBe("autopr/pr-42-abcdef123456");
  });

  it("rejects pull requests from a different project repository", () => {
    expect(githubRepositoriesMatch("Acme/Widget.git", "acme/widget")).toBe(true);
    expect(githubRepositoriesMatch("other/widget", "acme/widget")).toBe(false);
  });

  it("preserves the persisted source branch and owner for imported fork pull requests", () => {
    expect(resolveGithubPullRequestHead({
      baseOwner: "acme",
      localBranch: "autopr/pr-42-abcdef123456",
      importedHeadBranch: "retry-fix",
      importedHeadRepository: "contributor/widget",
    })).toEqual({
      branch: "retry-fix",
      owner: "contributor",
      reference: "contributor:retry-fix",
    });
  });

  it("only attaches to threads without live or materialized work", () => {
    expect(isThreadCompatibleWithGithubPullRequest({ worktreeStatus: "pending" })).toBe(true);
    expect(isThreadCompatibleWithGithubPullRequest({ worktreeStatus: "cleaned" })).toBe(true);
    expect(isThreadCompatibleWithGithubPullRequest({ worktreeStatus: "ready" })).toBe(false);
    expect(isThreadCompatibleWithGithubPullRequest({ worktreeStatus: "failed" })).toBe(false);
    expect(isThreadCompatibleWithGithubPullRequest({ isLive: true })).toBe(false);
    expect(isThreadCompatibleWithGithubPullRequest({ currentRunId: "run-1" })).toBe(false);
    expect(isThreadCompatibleWithGithubPullRequest({ triggerSessionCreatedAt: 1 })).toBe(false);
    expect(isThreadCompatibleWithGithubPullRequest({ hasMessages: true })).toBe(false);
    expect(isThreadCompatibleWithGithubPullRequest({ pullRequestNumber: 42 })).toBe(false);
  });
});

function response(data: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const basePull = {
  number: 42,
  title: "Improve retries",
  state: "open" as const,
  merged_at: null,
  draft: false,
  html_url: "https://github.com/acme/widget/pull/42",
  user: { login: "octocat" },
  head: {
    ref: "retry-fix",
    sha: "a".repeat(40),
    repo: { id: 1, full_name: "acme/widget", clone_url: "https://github.com/acme/widget.git" },
  },
  base: {
    ref: "main",
    sha: "b".repeat(40),
    repo: { id: 1, full_name: "acme/widget", clone_url: "https://github.com/acme/widget.git" },
  },
};

describe("resolveGithubPullRequest", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves a same-repository PR with push permission", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(basePull))
      .mockResolvedValueOnce(response({ permissions: { push: true } }))
      .mockResolvedValueOnce(response({ name: "retry-fix" }));
    vi.stubGlobal("fetch", fetchMock);

    const pull = await resolveGithubPullRequest("token", "acme", "widget", 42);
    expect(pull).toMatchObject({ state: "open", isFork: false, head: { canPush: true, branchAvailable: true } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("resolves a fork PR without assuming push permission", async () => {
    const forkPull = {
      ...basePull,
      head: {
        ...basePull.head,
        repo: { id: 2, full_name: "contributor/widget", clone_url: "https://github.com/contributor/widget.git" },
      },
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(forkPull))
      .mockResolvedValueOnce(response({ permissions: { push: false } }))
      .mockResolvedValueOnce(response({ name: "retry-fix" })));

    await expect(resolveGithubPullRequest("token", "acme", "widget", 42)).resolves.toMatchObject({
      isFork: true,
      head: { repositoryFullName: "contributor/widget", canPush: false },
    });
  });

  it("reports a deleted source branch without hiding the preview", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(basePull))
      .mockResolvedValueOnce(response({ permissions: { push: true } }))
      .mockResolvedValueOnce(response({ message: "Not Found" }, 404)));
    await expect(resolveGithubPullRequest("token", "acme", "widget", 42)).resolves.toMatchObject({
      head: { branchAvailable: false },
    });
  });

  it("rejects an unavailable fork repository", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({
      ...basePull,
      head: { ...basePull.head, repo: null },
    })));
    await expect(resolveGithubPullRequest("token", "acme", "widget", 42)).rejects.toMatchObject({
      name: GithubApiError.name,
      status: 410,
    });
  });

  it("preserves merged state", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ ...basePull, state: "closed", merged_at: "2026-01-01T00:00:00Z" }))
      .mockResolvedValueOnce(response({ permissions: { push: true } }))
      .mockResolvedValueOnce(response({ name: "retry-fix" })));
    await expect(resolveGithubPullRequest("token", "acme", "widget", 42)).resolves.toMatchObject({ state: "merged" });
  });

  it("looks up a fork branch using its persisted owner", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([]));
    vi.stubGlobal("fetch", fetchMock);

    await fetchGithubPullRequestForBranch("token", "acme", "widget", "retry-fix", {
      base: "main",
      state: "open",
      headOwner: "contributor",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toContain("head=contributor%3Aretry-fix");
  });
});

describe("pull request review data", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes the summary fields used by the review header", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({
      ...basePull,
      id: 9001,
      body: "## Summary\nSafer retries.",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      closed_at: null,
      additions: 17,
      deletions: 4,
      changed_files: 3,
      commits: 2,
      comments: 1,
      review_comments: 2,
      mergeable: true,
      mergeable_state: "clean",
      requested_reviewers: [{ login: "reviewer", avatar_url: "https://avatars.example/reviewer" }],
      labels: [{ name: "reliability", color: "2da44e" }],
    })));

    await expect(fetchGithubPullRequestDetail("token", "acme", "widget", 42)).resolves.toMatchObject({
      id: 9001,
      body: "## Summary\nSafer retries.",
      additions: 17,
      deletions: 4,
      changedFiles: 3,
      requestedReviewers: [{ login: "reviewer" }],
      labels: [{ name: "reliability" }],
    });
  });

  it("normalizes changed files and preserves omitted binary patches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(basePull)).mockResolvedValueOnce(response([
      {
        filename: "src/retry.ts",
        status: "modified",
        additions: 4,
        deletions: 1,
        changes: 5,
        patch: "@@ -1 +1 @@\n-old\n+new",
        blob_url: "https://github.com/acme/widget/blob/a/src/retry.ts",
      },
      {
        filename: "assets/logo.png",
        status: "modified",
        additions: 0,
        deletions: 0,
        changes: 0,
        blob_url: "https://github.com/acme/widget/blob/a/assets/logo.png",
      },
    ])).mockResolvedValueOnce(response(basePull)));

    const files = await fetchGithubPullRequestFiles("token", "acme", "widget", 42, basePull.head.sha);
    expect(files[0]).toMatchObject({ filename: "src/retry.ts", patch: expect.stringContaining("@@") });
    expect(files[1]).not.toHaveProperty("patch");
  });

  it("bounds changed-file pagination", async () => {
    const next = '<https://api.github.com/next>; rel="next"';
    const fetchMock = vi.fn().mockResolvedValueOnce(response(basePull));
    for (let page = 0; page < 5; page += 1) {
      fetchMock.mockResolvedValueOnce(response([{
        filename: `src/page-${page}.ts`,
        status: "modified",
        additions: 1,
        deletions: 0,
        changes: 1,
        blob_url: `https://github.com/acme/widget/blob/a/src/page-${page}.ts`,
      }], 200, { Link: next }));
    }
    fetchMock.mockResolvedValueOnce(response(basePull));
    vi.stubGlobal("fetch", fetchMock);

    const files = await fetchGithubPullRequestFiles("token", "acme", "widget", 42, basePull.head.sha);

    expect(files).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("rejects files when the displayed commit is already outdated", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({
      ...basePull, head: { ...basePull.head, sha: "c".repeat(40) },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchGithubPullRequestFiles("token", "acme", "widget", 42, basePull.head.sha))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("Refresh pull requests") });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects files when the head changes during pagination", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(basePull))
      .mockResolvedValueOnce(response([], 200, { Link: '<https://api.github.com/next>; rel="next"' }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ ...basePull, head: { ...basePull.head, sha: "c".repeat(40) } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchGithubPullRequestFiles("token", "acme", "widget", 42, basePull.head.sha))
      .rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("combines commits, comments, and reviews in chronological order", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response([{
        sha: "a".repeat(40),
        html_url: "https://github.com/acme/widget/commit/a",
        author: { login: "octocat" },
        commit: { message: "Fix retries\n\nKeep backoff bounded.", author: { name: "Octo Cat", date: "2026-01-02T00:00:00Z" } },
      }]))
      .mockResolvedValueOnce(response([{
        id: 1,
        html_url: "https://github.com/acme/widget/pull/42#issuecomment-1",
        body: "Can we cover the timeout?",
        created_at: "2026-01-01T00:00:00Z",
        user: { login: "reviewer" },
      }]))
      .mockResolvedValueOnce(response([
        {
          id: 2,
          html_url: "https://github.com/acme/widget/pull/42#pullrequestreview-2",
          body: null,
          state: "APPROVED",
          submitted_at: "2026-01-03T00:00:00Z",
          user: { login: "maintainer" },
        },
        {
          id: 3,
          html_url: "https://github.com/acme/widget/pull/42#pullrequestreview-3",
          body: null,
          state: "PENDING",
          submitted_at: null,
          user: { login: "reviewer" },
        },
      ]))
      .mockResolvedValueOnce(response([{
        id: 4,
        html_url: "https://github.com/acme/widget/pull/42#discussion_r4",
        body: "Handle cancellation here.",
        created_at: "2026-01-04T00:00:00Z",
        user: { login: "reviewer" },
        path: "src/retry.ts",
        line: null,
      }])));

    const timeline = await fetchGithubPullRequestTimeline("token", "acme", "widget", 42);
    expect(timeline.map((item) => item.kind)).toEqual(["comment", "commit", "review", "review-comment"]);
    expect(timeline[3]).toMatchObject({ kind: "review-comment", path: "src/retry.ts", body: "Handle cancellation here." });
    expect(timeline[3]).not.toHaveProperty("line");
    expect(timeline[2]).toMatchObject({ state: "approved", body: "" });
    expect(timeline).not.toContainEqual(expect.objectContaining({ id: "review:3" }));
  });
});

describe("pull request checks", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("combines check runs and the latest legacy status per context", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ check_runs: [
        { id: 1, name: "test", status: "completed", conclusion: "success", html_url: "https://github.com/check/1" },
        { id: 2, name: "lint", status: "in_progress", conclusion: null, html_url: null },
        { id: 3, name: "build", status: "completed", conclusion: "timed_out", html_url: null },
        { id: 4, name: "optional", status: "completed", conclusion: "skipped", html_url: null },
      ] }))
      .mockResolvedValueOnce(response([
        { id: 6, context: "deploy", state: "success", description: "Ready", target_url: "https://example.com/deploy" },
        { id: 5, context: "deploy", state: "failure", description: "Old attempt", target_url: null },
      ]));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchGithubPullRequestChecks("token", "acme", "widget", basePull.head.sha);
    expect(result.checks.map((check) => check.status)).toEqual(["success", "pending", "failure", "neutral", "success"]);
    expect(result).toMatchObject({ headSha: basePull.head.sha, truncated: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`/commits/${basePull.head.sha}/check-runs`);
    expect(fetchMock.mock.calls[1]?.[0]).toContain(`/commits/${basePull.head.sha}/statuses`);
  });

  it("reports partial results when GitHub has more pages", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ check_runs: [] }, 200, { Link: '<https://api.github.com/next>; rel="next"' }))
      .mockResolvedValueOnce(response([])));
    await expect(fetchGithubPullRequestChecks("token", "acme", "widget", basePull.head.sha)).resolves.toMatchObject({ truncated: true });
  });

  it("does not present a permissions failure as an empty checks list", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ message: "Forbidden" }, 403))
      .mockResolvedValueOnce(response([])));
    await expect(fetchGithubPullRequestChecks("token", "acme", "widget", basePull.head.sha)).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    ["https://ci.example/build/1", "https://ci.example/build/1"],
    ["http://ci.example/build/1", "http://ci.example/build/1"],
    ["javascript:alert(1)", null],
    ["data:text/html,hello", null],
    ["file:///etc/passwd", null],
    ["//ci.example/build/1", null],
    ["not a URL", null],
    [null, null],
  ])("only exposes HTTP(S) check links for %s", async (url, expected) => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ check_runs: [
        { id: 1, name: "test", status: "completed", conclusion: "success", html_url: url },
      ] }))
      .mockResolvedValueOnce(response([
        { id: 2, context: "deploy", state: "success", description: "Ready", target_url: url },
      ])));

    const result = await fetchGithubPullRequestChecks("token", "acme", "widget", basePull.head.sha);
    expect(result.checks.map((check) => check.url)).toEqual([expected, expected]);
  });

  it("preserves merged state in the repository list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response([
      { ...basePull, state: "closed", merged_at: "2026-01-02T00:00:00Z" },
    ])));
    await expect(fetchGithubPullRequests("token", "acme", "widget")).resolves.toMatchObject([
      { state: "closed", mergedAt: "2026-01-02T00:00:00Z" },
    ]);
  });
});
