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

export function resolveThreadBranchLabel(options: {
  status?: ThreadGitStatus;
  expectedBranch?: string;
  invalidatedAt?: number;
  readFailed?: boolean;
}) {
  const verifiedBranch = options.status?.detachedHead
    ? `detached@${options.status.localHeadSha?.slice(0, 7) ?? "HEAD"}`
    : options.status?.currentBranch;
  const statusIsOutdated = options.invalidatedAt !== undefined
    && options.invalidatedAt > (options.status?.checkedAt ?? 0);

  return statusIsOutdated && options.expectedBranch && !options.readFailed
    ? options.expectedBranch
    : verifiedBranch;
}

export function useThreadGitStatusQuery(options: {
  projectId: string;
  threadId: string;
  persistedStatus?: ThreadGitStatus;
  invalidatedAt?: number;
  enabled?: boolean;
  refetchInterval?: number | false;
}) {
  const persistedStatusIsOutdated = options.invalidatedAt !== undefined
    && options.invalidatedAt > (options.persistedStatus?.checkedAt ?? 0);

  return useQuery({
    queryKey: [
      ...threadGitStatusQueryKey(options.projectId, options.threadId),
      options.invalidatedAt ?? 0,
    ],
    enabled: options.enabled ?? true,
    queryFn: async () => {
      const response = await fetch(
        `/api/project/${encodeURIComponent(options.projectId)}/thread/${encodeURIComponent(options.threadId)}?gitStatus=1&refresh=1`,
      );
      const body = (await response.json().catch(() => ({}))) as GitStatusResponse;
      if (!response.ok || !body.status) {
        throw new Error(body.error?.message ?? "Could not refresh Git status.");
      }
      return body.status;
    },
    initialData: options.persistedStatus,
    initialDataUpdatedAt: persistedStatusIsOutdated ? 0 : options.persistedStatus?.checkedAt,
    staleTime: 10_000,
    retry: false,
    refetchInterval: options.refetchInterval,
    refetchOnWindowFocus: true,
  });
}
