import { hasObjectType, hasStringType } from "@autopr/config/runtime-type";

export interface GithubOAuthRepository {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  updatedAt?: string;
}

export interface GithubOAuthBranch {
  name: string;
  sha: string;
  protected: boolean;
}

export interface GithubOAuthPullRequest {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  htmlUrl: string;
  user: string;
  createdAt: string;
  updatedAt: string;
  draft: boolean;
  headRef: string;
  baseRef: string;
}

export interface GithubPullRequestActor {
  login: string;
  avatarUrl?: string;
}

export interface GithubPullRequestDetail extends GithubOAuthPullRequest {
  body: string;
  author: GithubPullRequestActor;
  mergedAt?: string;
  closedAt?: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  comments: number;
  reviewComments: number;
  mergeable: boolean | null;
  mergeableState: string;
  requestedReviewers: GithubPullRequestActor[];
  labels: Array<{ name: string; color: string }>;
}

export interface GithubPullRequestFile {
  filename: string;
  previousFilename?: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  blobUrl: string;
}

export type GithubPullRequestTimelineItem =
  | {
      id: string;
      kind: "commit";
      createdAt: string;
      actor: GithubPullRequestActor;
      title: string;
      message: string;
      sha: string;
      url: string;
    }
  | {
      id: string;
      kind: "comment" | "review";
      createdAt: string;
      actor: GithubPullRequestActor;
      body: string;
      url: string;
      state?: string;
    };

export interface ResolvedGithubPullRequest {
  number: number;
  title: string;
  author: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  htmlUrl: string;
  head: {
    repositoryId: number;
    repositoryFullName: string;
    cloneUrl: string;
    branch: string;
    sha: string;
    branchAvailable: boolean;
    canPush: boolean;
  };
  base: {
    repositoryId: number;
    repositoryFullName: string;
    cloneUrl: string;
    branch: string;
    sha: string;
  };
  isFork: boolean;
}

export class GithubApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GithubApiError";
  }
}

export interface CreatedGithubPullRequest {
  id: number;
  number: number;
  title: string;
  htmlUrl: string;
  headRef: string;
  baseRef: string;
}

const GITHUB_API_VERSION = "2022-11-28";
const MAX_ITEMS = 500;
const MAX_PULL_REQUEST_DATA_PAGES = 5;

function parseNextLink(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined;

  for (const link of linkHeader.split(",")) {
    const [urlPart, relPart] = link.split(";").map((part) => part.trim());
    if (relPart === 'rel="next"') {
      return urlPart?.replace(/^<|>$/g, "");
    }
  }

  return undefined;
}

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

async function githubJson<T>(token: string, url: string, init?: RequestInit): Promise<{ data: T; next?: string }> {
  const response = await fetch(url, { ...init, headers: { ...githubHeaders(token), ...init?.headers } });

  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    const message =
      body && hasObjectType(body) && "message" in body && hasStringType(body.message)
        ? body.message
        : "GitHub request failed.";
    throw new GithubApiError(message, response.status);
  }

  return {
    data: /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ (await response.json()) as T,
    next: parseNextLink(response.headers.get("link")),
  };
}

export async function resolveGithubPullRequest(
  token: string,
  owner: string,
  repo: string,
  number: number,
): Promise<ResolvedGithubPullRequest> {
  const response = await githubJson<{
    number: number;
    title: string;
    state: "open" | "closed";
    merged_at: string | null;
    draft?: boolean;
    html_url: string;
    user: { login: string } | null;
    head: {
      ref: string;
      sha: string;
      repo: null | { id: number; full_name: string; clone_url: string };
    };
    base: {
      ref: string;
      sha: string;
      repo: { id: number; full_name: string; clone_url: string };
    };
  }>(token, `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`);
  const pull = response.data;
  if (!pull.head.repo) {
    throw new GithubApiError("The pull request's source repository is no longer available.", 410);
  }

  let canPush = false;
  let branchAvailable = true;
  try {
    const headRepository = await githubJson<{ permissions?: { push?: boolean } }>(
      token,
      `https://api.github.com/repos/${pull.head.repo.full_name}`,
    );
    canPush = Boolean(headRepository.data.permissions?.push);
    await githubJson<unknown>(
      token,
      `https://api.github.com/repos/${pull.head.repo.full_name}/branches/${encodeURIComponent(pull.head.ref)}`,
    );
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 404) branchAvailable = false;
    else throw error;
  }

  const isFork = pull.head.repo.id !== pull.base.repo.id;
  return {
    number: pull.number,
    title: pull.title,
    author: pull.user?.login ?? "unknown",
    state: pull.merged_at ? "merged" : pull.state,
    draft: Boolean(pull.draft),
    htmlUrl: pull.html_url,
    head: {
      repositoryId: pull.head.repo.id,
      repositoryFullName: pull.head.repo.full_name.toLowerCase(),
      cloneUrl: pull.head.repo.clone_url,
      branch: pull.head.ref,
      sha: pull.head.sha,
      branchAvailable,
      canPush,
    },
    base: {
      repositoryId: pull.base.repo.id,
      repositoryFullName: pull.base.repo.full_name.toLowerCase(),
      cloneUrl: pull.base.repo.clone_url,
      branch: pull.base.ref,
      sha: pull.base.sha,
    },
    isFork,
  };
}

async function paginatedGithubJson<T>(
  token: string,
  initialUrl: string,
  options: { maxPages?: number } = {},
): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = initialUrl;
  let pages = 0;

  while (next && (options.maxPages === undefined || pages < options.maxPages)) {
    const page: { data: T[]; next?: string } = await githubJson<T[]>(token, next);
    items.push(...page.data);
    pages += 1;

    if (items.length > MAX_ITEMS) {
      throw new Error(`GitHub returned more than ${MAX_ITEMS} items. Narrow the selection and try again.`);
    }

    next = page.next;
  }

  return items;
}

function normalizeRepository(repo: {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  clone_url: string;
  default_branch: string;
  updated_at?: string;
  owner: { login: string };
}): GithubOAuthRepository {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name.toLowerCase(),
    owner: repo.owner.login,
    private: repo.private,
    htmlUrl: repo.html_url,
    cloneUrl: repo.clone_url,
    defaultBranch: repo.default_branch,
    updatedAt: repo.updated_at,
  };
}

export async function fetchGithubRepositories(token: string): Promise<GithubOAuthRepository[]> {
  const repos = await paginatedGithubJson<{
    id: number;
    name: string;
    full_name: string;
    private: boolean;
    html_url: string;
    clone_url: string;
    default_branch: string;
    updated_at?: string;
    owner: { login: string };
  }>(
    token,
    "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
  );

  return repos.map(normalizeRepository);
}

export async function fetchGithubBranches(token: string, owner: string, repo: string): Promise<GithubOAuthBranch[]> {
  const branches = await paginatedGithubJson<{
    name: string;
    protected: boolean;
    commit: { sha: string };
  }>(token, `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`);

  return branches.map((branch) => ({
    name: branch.name,
    sha: branch.commit.sha,
    protected: branch.protected,
  }));
}

export async function createGithubPullRequest(
  token: string,
  owner: string,
  repo: string,
  options: {
    title: string;
    head: string;
    base: string;
    body?: string;
    draft?: boolean;
  },
): Promise<CreatedGithubPullRequest> {
  const response = await githubJson<{
    id: number;
    number: number;
    title: string;
    html_url: string;
    head: { ref: string };
    base: { ref: string };
  }>(
    token,
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: options.title,
        head: options.head,
        base: options.base,
        body: options.body,
        draft: options.draft ?? false,
      }),
    },
  );

  return {
    id: response.data.id,
    number: response.data.number,
    title: response.data.title,
    htmlUrl: response.data.html_url,
    headRef: response.data.head.ref,
    baseRef: response.data.base.ref,
  };
}

export async function fetchGithubPullRequests(token: string, owner: string, repo: string): Promise<GithubOAuthPullRequest[]> {
  const pulls = await paginatedGithubJson<{
    id: number;
    number: number;
    title: string;
    state: "open" | "closed";
    html_url: string;
    user: { login: string } | null;
    created_at: string;
    updated_at: string;
    draft?: boolean;
    head: { ref: string };
    base: { ref: string };
  }>(
    token,
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=all&per_page=100&sort=updated&direction=desc`,
  );

  return pulls.map((pull) => ({
    id: pull.id,
    number: pull.number,
    title: pull.title,
    state: pull.state,
    htmlUrl: pull.html_url,
    user: pull.user?.login ?? "unknown",
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
    draft: Boolean(pull.draft),
    headRef: pull.head.ref,
    baseRef: pull.base.ref,
  }));
}

function githubActor(actor: { login: string; avatar_url?: string } | null): GithubPullRequestActor {
  return {
    login: actor?.login ?? "ghost",
    ...(() => {
  let optionalProperties;
  if (actor?.avatar_url) optionalProperties = { avatarUrl: actor.avatar_url };
  return optionalProperties;
})(),
  };
}

export async function fetchGithubPullRequestDetail(
  token: string,
  owner: string,
  repo: string,
  number: number,
): Promise<GithubPullRequestDetail> {
  const response = await githubJson<{
    id: number;
    number: number;
    title: string;
    body: string | null;
    state: "open" | "closed";
    html_url: string;
    user: { login: string; avatar_url?: string } | null;
    created_at: string;
    updated_at: string;
    closed_at: string | null;
    merged_at: string | null;
    draft?: boolean;
    head: { ref: string };
    base: { ref: string };
    additions: number;
    deletions: number;
    changed_files: number;
    commits: number;
    comments: number;
    review_comments: number;
    mergeable: boolean | null;
    mergeable_state: string;
    requested_reviewers?: Array<{ login: string; avatar_url?: string }>;
    labels?: Array<{ name: string; color: string }>;
  }>(token, `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`);
  const pull = response.data;

  return {
    id: pull.id,
    number: pull.number,
    title: pull.title,
    body: pull.body ?? "",
    state: pull.state,
    htmlUrl: pull.html_url,
    user: pull.user?.login ?? "ghost",
    author: githubActor(pull.user),
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
    ...(() => {
  let optionalProperties;
  if (pull.closed_at) optionalProperties = { closedAt: pull.closed_at };
  return optionalProperties;
})(),
    ...(() => {
  let optionalProperties;
  if (pull.merged_at) optionalProperties = { mergedAt: pull.merged_at };
  return optionalProperties;
})(),
    draft: Boolean(pull.draft),
    headRef: pull.head.ref,
    baseRef: pull.base.ref,
    additions: pull.additions,
    deletions: pull.deletions,
    changedFiles: pull.changed_files,
    commits: pull.commits,
    comments: pull.comments,
    reviewComments: pull.review_comments,
    mergeable: pull.mergeable,
    mergeableState: pull.mergeable_state,
    requestedReviewers: (pull.requested_reviewers ?? []).map(githubActor),
    labels: (pull.labels ?? []).map((label) => ({ name: label.name, color: label.color })),
  };
}

export async function fetchGithubPullRequestFiles(
  token: string,
  owner: string,
  repo: string,
  number: number,
): Promise<GithubPullRequestFile[]> {
  const files = await paginatedGithubJson<{
    filename: string;
    previous_filename?: string;
    status: GithubPullRequestFile["status"];
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
    blob_url: string;
  }>(
    token,
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/files?per_page=100`,
    { maxPages: MAX_PULL_REQUEST_DATA_PAGES },
  );

  return files.map((file) => ({
    filename: file.filename,
    ...(() => {
  let optionalProperties;
  if (file.previous_filename) optionalProperties = { previousFilename: file.previous_filename };
  return optionalProperties;
})(),
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    ...(() => {
  let optionalProperties;
  if (file.patch) optionalProperties = { patch: file.patch };
  return optionalProperties;
})(),
    blobUrl: file.blob_url,
  }));
}

export async function fetchGithubPullRequestTimeline(
  token: string,
  owner: string,
  repo: string,
  number: number,
): Promise<GithubPullRequestTimelineItem[]> {
  const baseUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const [commits, comments, reviews] = await Promise.all([
    paginatedGithubJson<{
      sha: string;
      html_url: string;
      author: { login: string; avatar_url?: string } | null;
      commit: {
        message: string;
        author: { name: string; date: string } | null;
      };
    }>(token, `${baseUrl}/pulls/${number}/commits?per_page=100`, { maxPages: MAX_PULL_REQUEST_DATA_PAGES }),
    paginatedGithubJson<{
      id: number;
      html_url: string;
      body: string;
      created_at: string;
      user: { login: string; avatar_url?: string } | null;
    }>(token, `${baseUrl}/issues/${number}/comments?per_page=100`, { maxPages: MAX_PULL_REQUEST_DATA_PAGES }),
    paginatedGithubJson<{
      id: number;
      html_url: string;
      body: string | null;
      state: string;
      submitted_at: string | null;
      user: { login: string; avatar_url?: string } | null;
    }>(token, `${baseUrl}/pulls/${number}/reviews?per_page=100`, { maxPages: MAX_PULL_REQUEST_DATA_PAGES }),
  ]);

  return [
    ...commits.map((commit): GithubPullRequestTimelineItem => {
      const [title = "Commit", ...bodyLines] = commit.commit.message.split("\n");
      return {
        id: `commit:${commit.sha}`,
        kind: "commit",
        createdAt: commit.commit.author?.date ?? "",
        actor: commit.author ? githubActor(commit.author) : { login: commit.commit.author?.name ?? "ghost" },
        title,
        message: bodyLines.join("\n").trim(),
        sha: commit.sha,
        url: commit.html_url,
      };
    }),
    ...comments.map((comment): GithubPullRequestTimelineItem => ({
      id: `comment:${comment.id}`,
      kind: "comment",
      createdAt: comment.created_at,
      actor: githubActor(comment.user),
      body: comment.body,
      url: comment.html_url,
    })),
    ...reviews.filter((review) => review.submitted_at !== null).map((review): GithubPullRequestTimelineItem => ({
      id: `review:${review.id}`,
      kind: "review",
      createdAt: review.submitted_at!,
      actor: githubActor(review.user),
      body: review.body ?? "",
      url: review.html_url,
      state: review.state.toLowerCase(),
    })),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function fetchGithubPullRequestForBranch(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  options: {
    base?: string;
    state?: "open" | "closed" | "all";
    headOwner?: string;
  } = {},
): Promise<GithubOAuthPullRequest | undefined> {
  const state = options.state ?? "all";
  const base = options.base ? `&base=${encodeURIComponent(options.base)}` : "";
  const headOwner = options.headOwner ?? owner;
  const response = await githubJson<Array<{
    id: number;
    number: number;
    title: string;
    state: "open" | "closed";
    html_url: string;
    user: { login: string } | null;
    created_at: string;
    updated_at: string;
    draft?: boolean;
    head: { ref: string };
    base: { ref: string };
  }>>(
    token,
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=${state}&head=${encodeURIComponent(`${headOwner}:${branch}`)}${base}&per_page=1`,
  );
  const pull = response.data[0];
  if (!pull) return undefined;

  return {
    id: pull.id,
    number: pull.number,
    title: pull.title,
    state: pull.state,
    htmlUrl: pull.html_url,
    user: pull.user?.login ?? "unknown",
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
    draft: Boolean(pull.draft),
    headRef: pull.head.ref,
    baseRef: pull.base.ref,
  };
}

export async function getGithubRepository(token: string, owner: string, repo: string): Promise<GithubOAuthRepository> {
  const response = await githubJson<{
    id: number;
    name: string;
    full_name: string;
    private: boolean;
    html_url: string;
    clone_url: string;
    default_branch: string;
    updated_at?: string;
    owner: { login: string };
  }>(token, `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);

  return normalizeRepository(response.data);
}
