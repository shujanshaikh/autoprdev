import { useQuery } from "@tanstack/react-query";

import type {
  GithubOAuthPullRequest,
  GithubPullRequestActor,
  GithubPullRequestDetail,
  GithubPullRequestFile,
  GithubPullRequestTimelineItem,
  fetchGithubPullRequestChecks,
} from "@autopr/backend/convex/lib/github_oauth";

export type ProjectPullRequestState = GithubOAuthPullRequest["state"];
export type ProjectPullRequest = GithubOAuthPullRequest;
export type ProjectPullRequestActor = GithubPullRequestActor;
export type ProjectPullRequestDetail = GithubPullRequestDetail;
export type ProjectPullRequestFile = GithubPullRequestFile;
export type ProjectPullRequestTimelineItem = GithubPullRequestTimelineItem;

export type ProjectPullRequestsResponse = {
  project: {
    projectId: string;
    repoFullName: string;
    githubUrl: string;
  };
  pulls: ProjectPullRequest[];
};

async function readJson<T>(response: Response): Promise<T> {
  const data: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = data && typeof data === "object" && "error" in data
      ? String(data.error)
      : "Request failed.";
    throw new Error(error);
  }

  return data as T;
}

export function useProjectPullRequests(projectId: string) {
  return useQuery({
    queryKey: ["project", projectId, "pulls"],
    staleTime: 30_000,
    queryFn: async () => readJson<ProjectPullRequestsResponse>(
      await fetch(`/api/project/${encodeURIComponent(projectId)}/pulls`),
    ),
  });
}

function pullRequestUrl(projectId: string, number: number, view?: "files" | "timeline" | "checks") {
  const query = new URLSearchParams({ number: String(number) });
  if (view) query.set("view", view);
  return `/api/project/${encodeURIComponent(projectId)}/pulls?${query}`;
}

export function useProjectPullRequest(projectId: string, number?: number) {
  return useQuery({
    queryKey: ["project", projectId, "pull", number, "detail"],
    enabled: number !== undefined,
    queryFn: async () => readJson<{ pullRequest: ProjectPullRequestDetail }>(
      await fetch(pullRequestUrl(projectId, number!)),
    ),
  });
}

export function useProjectPullRequestFiles(projectId: string, number?: number, enabled = true, headSha?: string) {
  return useQuery({
    queryKey: ["project", projectId, "pull", number, "files", headSha],
    enabled: number !== undefined && enabled,
    queryFn: async () => readJson<{ files: ProjectPullRequestFile[] }>(
      await fetch(pullRequestUrl(projectId, number!, "files")),
    ),
  });
}

export function useProjectPullRequestTimeline(projectId: string, number?: number, enabled = true) {
  return useQuery({
    queryKey: ["project", projectId, "pull", number, "timeline"],
    enabled: number !== undefined && enabled,
    queryFn: async () => readJson<{ timeline: ProjectPullRequestTimelineItem[] }>(
      await fetch(pullRequestUrl(projectId, number!, "timeline")),
    ),
  });
}

export function useProjectPullRequestChecks(projectId: string, number: number) {
  return useQuery({
    queryKey: ["project", projectId, "pull", number, "checks"],
    staleTime: 30_000,
    queryFn: async () => readJson<Awaited<ReturnType<typeof fetchGithubPullRequestChecks>>>(
      await fetch(pullRequestUrl(projectId, number, "checks")),
    ),
  });
}
