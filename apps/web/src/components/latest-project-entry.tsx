import { Button } from "@autopr/ui/components/button";
import { api } from "@autopr/backend/convex/_generated/api";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { GitBranch, Plus } from "lucide-react";
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
            <div className="mb-8 flex size-16 items-center justify-center rounded-lg border border-border bg-card">
              <GitBranch className="size-7 text-muted-foreground" />
            </div>

            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
              no projects
            </p>

            <h1 className="mt-4 font-display text-3xl font-normal tracking-normal text-foreground">
              Create your first project
            </h1>

            <p className="mt-3 max-w-sm text-base leading-7 text-muted-foreground">
              Connect a GitHub repository and launch a sandbox to get started.
            </p>

            <Button
              type="button"
              size="lg"
              onClick={openCreateProject}
              className="mt-8 h-12 px-8 text-base"
            >
              <Plus className="size-5" aria-hidden="true" />
              Create project
            </Button>

            <p className="mt-12 text-xs text-muted-foreground/40">
              Have existing projects? Open one from the sidebar.
            </p>
          </div>
        </main>
      )}
    </WorkspaceShell>
  );
}
