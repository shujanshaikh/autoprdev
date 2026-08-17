import type { ThreadGitStatus } from "@autopr/backend/convex/lib/gitStatus";
import { useQuery } from "@tanstack/react-query";

interface GitStatusResponse {
  status?: ThreadGitStatus;
  error?: {
    code: string;
    message: string;
  };
}

export function threadGitStatusQueryKey(projectId: string, threadId: string) {
  return ["thread", projectId, threadId, "git-status"] as const;
}

export function useThreadGitStatusQuery(options: {
  projectId: string;
  threadId: string;
  persistedStatus?: ThreadGitStatus;
  enabled?: boolean;
  refetchInterval?: number | false;
}) {
  return useQuery({
    queryKey: threadGitStatusQueryKey(options.projectId, options.threadId),
    enabled: options.enabled ?? true,
    queryFn: async () => {
      const response = await fetch(
        `/api/project/${encodeURIComponent(options.projectId)}/thread/${encodeURIComponent(options.threadId)}?gitStatus=1&refresh=1`,
      );
      const body = (await response.json().catch(() => ({}))) satisfies GitStatusResponse;
      if (!response.ok || !body.status) {
        throw new Error(body.error?.message ?? "Could not refresh Git status.");
      }
      return body.status;
    },
    initialData: options.persistedStatus,
    initialDataUpdatedAt: options.persistedStatus?.checkedAt,
    staleTime: 10_000,
    retry: false,
    refetchInterval: options.refetchInterval,
    refetchOnWindowFocus: true,
  });
}
