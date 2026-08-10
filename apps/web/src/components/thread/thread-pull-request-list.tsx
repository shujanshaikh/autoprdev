import { PullRequestWorkspace } from "#/components/pull-request/pull-request-workspace";

export function ThreadPullRequestList({
  projectId,
  currentPullRequestNumber,
}: {
  projectId: string;
  currentPullRequestNumber?: number;
}) {
  return <PullRequestWorkspace projectId={projectId} currentPullRequestNumber={currentPullRequestNumber} variant="panel" />;
}
