export const DEFAULT_SANDBOX_WORKDIR = "/home";

function repoNameFromUrl(repoUrl?: string): string | undefined {
  if (!repoUrl) {
    return undefined;
  }

  try {
    const url = new URL(repoUrl);
    const segments = url.pathname.split("/").filter(Boolean);
    const segment = segments[segments.length - 1];
    return segment?.replace(/\.git$/i, "");
  } catch {
    const segments = repoUrl.split(/[/:]/).filter(Boolean);
    const segment = segments[segments.length - 1];
    return segment?.replace(/\.git$/i, "");
  }
}

export function sandboxRepositoryDirectoryName(options: {
  repoName?: string;
  repoUrl?: string;
}): string {
  const candidate = options.repoName ?? repoNameFromUrl(options.repoUrl);

  if (!candidate?.trim()) {
    throw new Error("Repository name or URL is required to resolve the sandbox repository path.");
  }

  const cleaned = candidate
    .trim()
    .replace(/\.git$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 120);

  if (!cleaned) {
    throw new Error("Repository name resolved to an empty sandbox directory.");
  }

  return cleaned;
}

export function sandboxRepositoryPath(sandboxWorkDir: string, repoDirectoryName: string): string {
  return `${sandboxWorkDir.replace(/\/+$/, "")}/${repoDirectoryName}`;
}

export function sandboxRelativeRepositoryPath(sandboxWorkDir: string, sandboxRepoPath: string): string {
  const root = sandboxWorkDir.replace(/\/+$/, "");
  const repoPath = sandboxRepoPath.replace(/\/+$/, "");

  if (repoPath === root) {
    return ".";
  }

  if (repoPath.startsWith(`${root}/`)) {
    return repoPath.slice(root.length + 1);
  }

  return repoPath;
}
