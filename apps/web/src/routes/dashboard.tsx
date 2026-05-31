import { api } from "@autopr/backend/convex/_generated/api";
import { SidebarTrigger } from "@autopr/ui/components/sidebar";
import { createFileRoute } from "@tanstack/react-router";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useConvexAuth,
  useQuery,
} from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

import { type SandboxRuntimeStatus, type SandboxStatus } from "#/components/dashboard/types";
import { WorkspaceShell } from "#/components/workspace-shell";

interface DashboardProject {
  projectId: string;
  repoFullName: string;
  sandboxStatus: SandboxStatus;
  sandboxRuntimeStatus?: SandboxRuntimeStatus | null;
  currentBranch?: string | null;
  repoBranch?: string | null;
  defaultBranch?: string | null;
  lastOpenedAt?: number;
  updatedAt: number;
}

function SignInRedirect() {
  useEffect(() => {
    window.location.replace("/api/auth/sign-in?returnTo=%2Fdashboard");
  }, []);

  return null;
}

function Dashboard() {
  const { isAuthenticated } = useConvexAuth();
  const projects = useQuery(api.projects.list, isAuthenticated ? {} : "skip") as DashboardProject[] | undefined;
  const projectCount = projects?.length ?? 0;

  return (
    <>
      <Authenticated>
        <WorkspaceShell>
          <div className="dashboard-shell relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
            <header className="relative z-10 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
              <SidebarTrigger />
              <div className="min-w-0">
                <h1 className="truncate text-[14px] font-semibold tracking-tight text-foreground">
                  Projects
                </h1>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/65">
                  {String(projectCount).padStart(2, "0")} sandboxes
                </p>
              </div>
            </header>

            <main className="minimal-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              <div className="mx-auto flex min-h-64 w-full max-w-4xl items-center justify-center">
                <p className="text-center text-sm text-muted-foreground">
                  Open Settings from the sidebar to view project and billing details.
                </p>
              </div>
            </main>
          </div>
        </WorkspaceShell>
      </Authenticated>

      <Unauthenticated>
        <SignInRedirect />
      </Unauthenticated>

      <AuthLoading>
        <div className="grid min-h-svh place-items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          <span className="font-mono text-[10px] uppercase tracking-[0.24em]">
            loading
          </span>
        </div>
      </AuthLoading>
    </>
  );
}

export const Route = createFileRoute("/dashboard")({ component: Dashboard });
