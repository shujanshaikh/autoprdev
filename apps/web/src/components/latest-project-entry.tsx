import { Button } from "@autopr/ui/components/button";
import { api } from "@autopr/backend/convex/_generated/api";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useEffect } from "react";

import { WorkspaceShell } from "#/components/workspace-shell";

export function LatestProjectEntry() {
  const navigate = useNavigate();
  const latestProject = useQuery(api.projects.latest, {});

  useEffect(() => {
    if (!latestProject) return;

    navigate({
      to: "/project/$projectId",
      params: { projectId: latestProject.projectId },
      replace: true,
    });
  }, [latestProject, navigate]);

  if (latestProject === undefined || latestProject) {
    return null;
  }

  return (
    <WorkspaceShell>
      {({ openCreateProject }) => (
        <main className="relative flex min-h-0 flex-1 items-center justify-center bg-background px-6">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-x-8 top-12 border-t border-border/70" />
            <div className="absolute inset-x-8 bottom-12 border-t border-border/50" />
          </div>

          <div className="relative flex flex-col items-center text-center">
            <Button
              type="button"
              size="lg"
              onClick={openCreateProject}
              className="h-12 px-8 text-base"
            >
              <Plus className="size-5" aria-hidden="true" />
              Create sandbox
            </Button>
          </div>
        </main>
      )}
    </WorkspaceShell>
  );
}
