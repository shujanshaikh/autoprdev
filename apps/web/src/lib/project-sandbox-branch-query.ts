import { useQuery } from "@tanstack/react-query";

export interface ProjectSandboxBranchState {
  available: boolean;
  branch: string | null;
  detachedHead: boolean;
  commitSha: string;
  hasChanges: boolean;
  checkedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseProjectSandboxBranchResponse(value: unknown): ProjectSandboxBranchState {
  if (
    !isRecord(value) ||
    typeof value.available !== "boolean" ||
    typeof value.detachedHead !== "boolean" ||
    typeof value.commitSha !== "string" ||
    typeof value.hasChanges !== "boolean" ||
    typeof value.checkedAt !== "number" ||
    (value.branch !== null && typeof value.branch !== "string")
  ) {
    throw new Error(
      isRecord(value) && typeof value.error === "string"
        ? value.error
        : "Could not read the sandbox branch.",
    );
  }

  return {
    available: value.available,
    branch: value.branch,
    detachedHead: value.detachedHead,
    commitSha: value.commitSha,
    hasChanges: value.hasChanges,
    checkedAt: value.checkedAt,
  };
}

export function projectSandboxBranchQueryKey(projectId: string) {
  return ["project", projectId, "sandbox-branch"] as const;
}

export function useProjectSandboxBranchQuery(options: {
  projectId: string;
  enabled: boolean;
  refetchInterval?: number | false;
}) {
  return useQuery({
    queryKey: projectSandboxBranchQueryKey(options.projectId),
    enabled: options.enabled,
    queryFn: async (): Promise<ProjectSandboxBranchState> => {
      const response = await fetch(`/api/project/${encodeURIComponent(options.projectId)}/branch`);
      if (!response.ok) {
        const errorBody: unknown = await response.json().catch(() => ({}));
        throw new Error(
          isRecord(errorBody) && typeof errorBody.error === "string"
            ? errorBody.error
            : "Could not read the sandbox branch.",
        );
      }
      const body: unknown = await response.json().catch(() => ({}));
      return parseProjectSandboxBranchResponse(body);
    },
    staleTime: 5_000,
    refetchInterval: options.refetchInterval ?? 15_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}
