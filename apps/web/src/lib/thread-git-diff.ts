export type ThreadGitFileDiff = {
  file: string;
  patch: string;
  patchOmitted: boolean;
  status: "added" | "deleted" | "modified";
};

type ThreadGitFileDiffResponse = {
  diff?: ThreadGitFileDiff;
  error?: {
    code?: string;
    message?: string;
  };
};

export async function fetchThreadGitFileDiff(options: {
  projectId: string;
  threadId: string;
  file: string;
}) {
  const response = await fetch(
    `/api/project/${encodeURIComponent(options.projectId)}`
      + `/thread/${encodeURIComponent(options.threadId)}`
      + `?gitDiff=${encodeURIComponent(options.file)}`,
  );
  const body = await response.json().catch(() => ({})) as ThreadGitFileDiffResponse;

  if (!response.ok || !body.diff) {
    throw new Error(body.error?.message ?? "Could not open the file diff.");
  }

  return body.diff;
}
