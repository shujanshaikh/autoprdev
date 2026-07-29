import "@tanstack/react-start/server-only";

import { generateCommitMetadata } from "#/lib/generated-git-metadata";

export async function generateCommitMessage(options: {
  request: Request;
  projectId: string;
  threadId: string;
  branch: string;
  status: string;
  diff: string;
}) {
  return (await generateCommitMetadata(options)).commitMessage;
}
