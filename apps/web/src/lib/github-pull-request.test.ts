import { afterEach, describe, expect, it, vi } from "vitest";

import {
  githubPullRequestLocalBranch,
  githubRepositoriesMatch,
  isThreadCompatibleWithGithubPullRequest,
  parseGithubPullRequestReference,
  resolveGithubPullRequestHead,
} from "@autopr/backend/convex/lib/githubPullRequest";
import {
  fetchGithubPullRequestForBranch,
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

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
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
