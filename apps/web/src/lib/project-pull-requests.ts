import { useQuery } from "@tanstack/react-query";

export type ProjectPullRequestState = "open" | "closed";

export type ProjectPullRequest = {
  id: number;
  number: number;
  title: string;
  state: ProjectPullRequestState;
  htmlUrl: string;
  user: string;
  updatedAt: string;
  draft: boolean;
  headRef: string;
  baseRef: string;
};

export type ProjectPullRequestActor = {
  login: string;
  avatarUrl?: string;
};

export type ProjectPullRequestDetail = ProjectPullRequest & {
  body: string;
  author: ProjectPullRequestActor;
  createdAt: string;
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
  requestedReviewers: ProjectPullRequestActor[];
  labels: Array<{ name: string; color: string }>;
};

export type ProjectPullRequestFile = {
  filename: string;
  previousFilename?: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  blobUrl: string;
};

export type ProjectPullRequestTimelineItem =
  | {
      id: string;
      kind: "commit";
      createdAt: string;
      actor: ProjectPullRequestActor;
      title: string;
      message: string;
      sha: string;
      url: string;
    }
  | {
      id: string;
      kind: "comment" | "review";
      createdAt: string;
      actor: ProjectPullRequestActor;
      body: string;
      url: string;
      state?: string;
    };

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
    queryFn: async () => readJson<ProjectPullRequestsResponse>(
      await fetch(`/api/project/${encodeURIComponent(projectId)}/pulls`),
    ),
  });
}

function pullRequestUrl(projectId: string, number: number, view?: "files" | "timeline") {
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

export function useProjectPullRequestFiles(projectId: string, number?: number, enabled = true) {
  return useQuery({
    queryKey: ["project", projectId, "pull", number, "files"],
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
