import { api } from "@autopr/backend/convex/_generated/api";
import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";

import { AuthGate } from "#/components/project-shell";
import { WorkspaceShell } from "#/components/workspace-shell";

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const location = useLocation();
  const { isAuthenticated } = useConvexAuth();
  const project = useQuery(api.projects.get, isAuthenticated ? { projectId } : "skip");
  const threads = useQuery(api.threads.listByProject, isAuthenticated ? { projectId } : "skip");
  const activeThreadId = location.pathname.match(/\/thread\/([^/?#]+)/)?.[1];

  return (
    <AuthGate>
      <WorkspaceShell
        activeProjectId={project?.projectId ?? projectId}
        activeProjectThreads={threads}
        activeThreadId={activeThreadId ? decodeURIComponent(activeThreadId) : undefined}
      >
        <Outlet />
      </WorkspaceShell>
    </AuthGate>
  );
}

export const Route = createFileRoute("/project/$projectId")({ component: ProjectLayout });
