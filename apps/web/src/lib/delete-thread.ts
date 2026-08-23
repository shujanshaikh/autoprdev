import { hasStringType } from "@autopr/config/runtime-type";

export async function deleteThreadWithCleanup(projectId: string, threadId: string) {
  const response = await fetch(
    `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}`,
    { method: "DELETE" },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      hasStringType(body.error) ? body.error : "Could not safely delete the thread.",
    );
  }
  return body satisfies { projectId: string; threadId: string };
}
