export interface NormalizedGithubUrl {
  githubUrl: string;
  cloneUrl: string;
  repoFullName: string;
  repoOwner: string;
  repoName: string;
  repoBranch?: string;
}

export function normalizeGithubUrl(input: string): NormalizedGithubUrl {
  const rawValue = input.trim();

  if (!rawValue) {
    throw new Error("Enter a GitHub repository URL.");
  }

  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error("Enter a valid https://github.com/owner/repo URL.");
  }

  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Only public HTTPS GitHub repository URLs are supported.");
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const [owner, repoSegment, routeType, ...routeRest] = segments;
  const repoName = repoSegment?.replace(/\.git$/i, "");

  if (!owner || !repoName) {
    throw new Error("GitHub URL must include an owner and repository name.");
  }

  if (repoName !== repoSegment && segments.length > 2) {
    throw new Error("Use the repository URL or a /tree/[branch] URL.");
  }

  let repoBranch: string | undefined;
  if (segments.length > 2) {
    if (routeType !== "tree" || routeRest.length === 0) {
      throw new Error("Only repository URLs and /tree/[branch] URLs are supported.");
    }
    repoBranch = routeRest.map(decodeURIComponent).join("/");
  }

  const repoOwner = decodeURIComponent(owner);
  const decodedRepoName = decodeURIComponent(repoName);
  const githubUrl = `https://github.com/${repoOwner}/${decodedRepoName}`;

  return {
    githubUrl,
    cloneUrl: `${githubUrl}.git`,
    repoFullName: `${repoOwner}/${decodedRepoName}`.toLowerCase(),
    repoOwner,
    repoName: decodedRepoName,
    repoBranch,
  };
}
