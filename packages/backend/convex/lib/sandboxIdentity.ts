export const AUTOPR_PROJECT_LABEL = "autopr-project-id";

export function autoprSandboxName(projectId: string) {
  return `autopr-${projectId}`;
}

export function autoprSandboxLabels(projectId: string) {
  return {
    [AUTOPR_PROJECT_LABEL]: projectId,
  };
}

export function isExpectedAutoprSandbox(
  sandbox: { name?: string; labels?: Record<string, string> },
  projectId: string,
) {
  return (
    sandbox.name === autoprSandboxName(projectId)
    && sandbox.labels?.[AUTOPR_PROJECT_LABEL] === projectId
  );
}
