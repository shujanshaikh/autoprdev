export interface ParsedGithubPullRequestReference {
  number: number;
  owner?: string;
  repo?: string;
}

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function parseNumber(value: string): number | undefined {
  const normalized = value.replace(/^#/, "");
  if (!/^[1-9]\d*$/.test(normalized)) return undefined;
  const number = Number(normalized);
  return Number.isSafeInteger(number) ? number : undefined;
}

function parseGithubUrl(value: string): ParsedGithubPullRequestReference | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") return undefined;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 4 || parts[2]?.toLowerCase() !== "pull") return undefined;
    const number = parseNumber(parts[3] ?? "");
    if (!number || !parts[0] || !parts[1]) return undefined;
    return { number, owner: decodeURIComponent(parts[0]), repo: decodeURIComponent(parts[1]).replace(/\.git$/i, "") };
  } catch {
    return undefined;
  }
}

function tokenizeCommand(value: string): string[] {
  return value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((token) => token.replace(/^(["'])|(["'])$/g, "")) ?? [];
}

/** Parses GitHub PR URLs, numbers, #numbers, and common `gh pr checkout` forms. */
export function parseGithubPullRequestReference(input: string): ParsedGithubPullRequestReference {
  const value = input.trim();
  if (!value) throw new Error("Enter a GitHub pull request URL or number.");

  const directUrl = parseGithubUrl(value);
  if (directUrl) return directUrl;
  const directNumber = parseNumber(value);
  if (directNumber) return { number: directNumber };

  const tokens = tokenizeCommand(value);
  if (tokens[0] !== "gh" || tokens[1] !== "pr" || tokens[2] !== "checkout") {
    throw new Error("Enter a PR URL, #number, number, or a gh pr checkout command.");
  }

  let repository: string | undefined;
  let reference: string | undefined;
  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--repo" || token === "-R") {
      repository = tokens[index + 1];
      index += 1;
      continue;
    }
    if (token === "--branch" || token === "-b") {
      index += 1;
      continue;
    }
    if (token?.startsWith("--repo=")) {
      repository = token.slice("--repo=".length);
      continue;
    }
    if (!token?.startsWith("-") && !reference) reference = token;
  }

  if (!reference) throw new Error("The gh pr checkout command is missing a pull request.");
  const parsed = parseGithubUrl(reference);
  const number = parsed?.number ?? parseNumber(reference);
  if (!number) throw new Error("The gh pr checkout command must contain a PR URL or number.");

  if (repository) {
    if (!REPOSITORY_PATTERN.test(repository)) throw new Error("The --repo value must be owner/repository.");
    const [owner, repo] = repository.split("/");
    if (parsed && (`${parsed.owner}/${parsed.repo}`).toLowerCase() !== repository.toLowerCase()) {
      throw new Error("The PR URL and --repo option refer to different repositories.");
    }
    return { number, owner, repo: repo?.replace(/\.git$/i, "") };
  }

  return parsed ?? { number };
}

export function githubPullRequestLocalBranch(number: number, headSha: string) {
  return `autopr/pr-${number}-${headSha.slice(0, 12).toLowerCase()}`;
}

export function githubRepositoriesMatch(left: string, right: string) {
  return left.trim().replace(/\.git$/i, "").toLowerCase() === right.trim().replace(/\.git$/i, "").toLowerCase();
}

export function resolveGithubPullRequestHead(options: {
  baseOwner: string;
  localBranch: string;
  importedHeadBranch?: string;
  importedHeadRepository?: string;
}) {
  const importedOwner = options.importedHeadRepository?.split("/", 1)[0]?.trim();
  const importedBranch = options.importedHeadBranch?.trim();
  const branch = importedBranch && importedOwner ? importedBranch : options.localBranch;
  const owner = importedBranch && importedOwner ? importedOwner : options.baseOwner;

  return {
    branch,
    owner,
    reference: owner.toLowerCase() === options.baseOwner.toLowerCase()
      ? branch
      : `${owner}:${branch}`,
  };
}

export function isThreadCompatibleWithGithubPullRequest(thread: {
  pullRequestNumber?: number;
  isLive?: boolean;
  currentRunId?: string;
  triggerSessionCreatedAt?: number;
  hasMessages?: boolean;
  worktreeStatus?: "pending" | "provisioning" | "ready" | "failed" | "cleaned";
}) {
  return !thread.pullRequestNumber &&
    !thread.isLive &&
    !thread.currentRunId &&
    !thread.triggerSessionCreatedAt &&
    !thread.hasMessages &&
    (thread.worktreeStatus === undefined || thread.worktreeStatus === "pending" || thread.worktreeStatus === "cleaned");
}
