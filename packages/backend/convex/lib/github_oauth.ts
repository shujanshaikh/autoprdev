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
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : "GitHub request failed.";
    throw new GithubApiError(message, response.status);
  }

  return {
    data: (await response.json()) as T,
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

async function paginatedGithubJson<T>(token: string, initialUrl: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = initialUrl;

  while (next) {
    const page: { data: T[]; next?: string } = await githubJson<T[]>(token, next);
    items.push(...page.data);

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
