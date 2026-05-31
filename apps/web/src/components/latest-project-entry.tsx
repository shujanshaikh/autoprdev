import { api } from "@autopr/backend/convex/_generated/api";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

import { WorkspaceShell } from "#/components/workspace-shell";

export function LoadingState({ label = "loading" }: { label?: string }) {
  return (
    <div className="grid min-h-svh place-items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      <span className="font-mono text-[10px] uppercase tracking-[0.24em]">
        {label}
      </span>
    </div>
  );
}

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
    return <LoadingState label="opening project" />;
  }

  return (
    <WorkspaceShell>
      <main className="flex min-h-0 flex-1 items-center justify-center bg-background px-5 py-10">
        <div className="max-w-sm text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            no projects
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
            Create your first project
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Use the new project control in the sidebar to connect a repository and start a sandbox.
          </p>
        </div>
      </main>
    </WorkspaceShell>
  );
}
