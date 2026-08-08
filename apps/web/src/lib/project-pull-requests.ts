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
