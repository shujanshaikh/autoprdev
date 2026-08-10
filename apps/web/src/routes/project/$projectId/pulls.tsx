import { createFileRoute } from "@tanstack/react-router";

import { PullRequestWorkspace } from "#/components/pull-request/pull-request-workspace";

function PullsPage() {
  const { projectId } = Route.useParams();
  return (
    <main className="h-full min-h-0 flex-1 overflow-hidden">
      <PullRequestWorkspace projectId={projectId} />
    </main>
  );
}

export const Route = createFileRoute("/project/$projectId/pulls")({ component: PullsPage });
