import { hasBooleanType, hasNumberType, hasStringType } from "@autopr/config/runtime-type";
import { isJsonObject, type JsonObject } from "@autopr/config/runtime-value";

import { useQuery } from "@tanstack/react-query";

export interface ProjectSandboxBranchState {
  available: boolean;
  branch: string | null;
  detachedHead: boolean;
  commitSha: string;
  hasChanges: boolean;
  checkedAt: number;
}

function isRecord<ValueValue>(value: ValueValue): value is ValueValue & (JsonObject) {
  return isJsonObject(value);
}

export function parseProjectSandboxBranchResponse<ValueValue>(value: ValueValue): ProjectSandboxBranchState {
  if (
    !isRecord(value) ||
    !hasBooleanType(value.available) ||
    !hasBooleanType(value.detachedHead) ||
    !hasStringType(value.commitSha) ||
    !hasBooleanType(value.hasChanges) ||
    !hasNumberType(value.checkedAt) ||
    (value.branch !== null && !hasStringType(value.branch))
  ) {
    throw new Error(
      isRecord(value) && hasStringType(value.error)
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
          isRecord(errorBody) && hasStringType(errorBody.error)
            ? errorBody.error
            : "Could not read the sandbox branch.",
        );
      }
      const body: unknown = await response.json().catch(() => ({}));
      return parseProjectSandboxBranchResponse(body);
    },
    staleTime: 5_000,
    retry: false,
    refetchInterval: options.refetchInterval ?? false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}
