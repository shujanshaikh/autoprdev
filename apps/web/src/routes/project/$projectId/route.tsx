import { api } from "@autopr/backend/convex/_generated/api";
import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect } from "react";

import { AuthGate } from "#/components/project-shell";
import { WorkspaceShell } from "#/components/workspace-shell";

function safeDecodePathSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const location = useLocation();
  const { isAuthenticated } = useConvexAuth();
  const project = useQuery(api.projects.get, isAuthenticated ? { projectId } : "skip");
  const markProjectOpened = useMutation(api.projects.markOpened);
  const activeThreadId = location.pathname.match(/\/thread\/([^/?#]+)/)?.[1];
  const openedProjectId = project?.projectId;

  useEffect(() => {
    if (!openedProjectId) return;

    void markProjectOpened({ projectId: openedProjectId });
  }, [markProjectOpened, openedProjectId]);

  return (
    <AuthGate>
      <WorkspaceShell
        activeProjectId={project?.projectId ?? projectId}
        activeThreadId={activeThreadId ? safeDecodePathSegment(activeThreadId) : undefined}
      >
        <Outlet />
      </WorkspaceShell>
    </AuthGate>
  );
}

export const Route = createFileRoute("/project/$projectId")({ component: ProjectLayout });
