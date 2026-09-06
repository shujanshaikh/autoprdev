import { createFileRoute } from "@tanstack/react-router";

import { PullRequestWorkspace } from "#/components/pull-request/pull-request-workspace";

function PullsPage() {
  const { projectId } = Route.useParams();
  const { number } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <main className="h-full min-h-0 flex-1 overflow-hidden">
      <PullRequestWorkspace
        key={projectId}
        projectId={projectId}
        currentPullRequestNumber={number}
        onSelectPullRequest={(number) => void navigate({ search: number === undefined ? {} : { number } })}
      />
    </main>
  );
}

export const Route = createFileRoute("/project/$projectId/pulls")({
  validateSearch: (search: Record<string, unknown>): { number?: number } => {
    const number = Number(search.number);
    return Number.isSafeInteger(number) && number > 0 ? { number } : {};
  },
  component: PullsPage,
});
