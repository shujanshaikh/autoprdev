import { api } from "@autopr/backend/convex/_generated/api";
import { TooltipProvider } from "@autopr/ui/components/tooltip";
import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";

import { AuthGate, ProjectShell } from "#/components/project-shell";

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const location = useLocation();
  const { isAuthenticated } = useConvexAuth();
  const project = useQuery(api.projects.get, isAuthenticated ? { projectId } : "skip");
  const threads = useQuery(api.threads.listByProject, isAuthenticated ? { projectId } : "skip");
  const activeThreadId = location.pathname.match(/\/thread\/([^/?#]+)/)?.[1];

  return (
    <AuthGate>
      <TooltipProvider>
        <ProjectShell
          projectId={projectId}
          repoFullName={project?.repoFullName}
          threads={threads}
          activeThreadId={activeThreadId ? decodeURIComponent(activeThreadId) : undefined}
        >
          <Outlet />
        </ProjectShell>
      </TooltipProvider>
    </AuthGate>
  );
}

export const Route = createFileRoute("/project/$projectId")({ component: ProjectLayout });
