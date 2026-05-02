"use client";

import { api } from "@autopr/backend/convex/_generated/api";
import { TooltipProvider } from "@autopr/ui/components/tooltip";
import { useConvexAuth, useQuery } from "convex/react";
import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { AuthGate, ProjectShell } from "@/components/project-shell";

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ projectId: string }>();
  const pathname = usePathname();
  const { isAuthenticated } = useConvexAuth();
  const projectId = params.projectId;
  const project = useQuery(api.projects.get, isAuthenticated ? { projectId } : "skip");
  const threads = useQuery(api.threads.listByProject, isAuthenticated ? { projectId } : "skip");
  const activeThreadId = pathname.match(/\/thread\/([^/?#]+)/)?.[1];

  return (
    <AuthGate>
      <TooltipProvider>
        <ProjectShell
          projectId={projectId}
          repoFullName={project?.repoFullName}
          threads={threads}
          activeThreadId={activeThreadId ? decodeURIComponent(activeThreadId) : undefined}
        >
          {children}
        </ProjectShell>
      </TooltipProvider>
    </AuthGate>
  );
}
