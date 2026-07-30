export async function deleteThreadWithCleanup(projectId: string, threadId: string) {
  const response = await fetch(
    `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}`,
    { method: "DELETE" },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof body.error === "string" ? body.error : "Could not safely delete the thread.",
    );
  }
  return body as { projectId: string; threadId: string };
}
