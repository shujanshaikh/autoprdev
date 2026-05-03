"use client";

import { Loader2 } from "lucide-react";

import { ProjectRow } from "./project-card";
import type { SandboxStatus } from "./types";

interface Project {
  projectId: string;
  repoFullName: string;
  cloneUrl: string;
  sandboxStatus: SandboxStatus;
  currentBranch?: string | null;
  repoBranch?: string | null;
  defaultBranch?: string | null;
}

interface ProjectGridProps {
  projects: Project[] | undefined;
  onDelete: (projectId: string) => void;
}

export function ProjectGrid({ projects, onDelete }: ProjectGridProps) {
  if (projects === undefined) {
    return (
      <div className="flex min-h-[12rem] flex-col items-center justify-center gap-2 border border-border bg-card font-mono text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        <span className="uppercase tracking-[0.22em]">loading</span>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex min-h-[14rem] flex-col items-center justify-center gap-3 border border-dashed border-border bg-card/40 px-8 text-center">
        <div className="grid size-10 place-items-center border border-border font-mono text-xs text-muted-foreground/70">
          ∅
        </div>
        <div className="space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground">
            no sandboxes yet
          </p>
          <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
            Walk through the flow above to launch your first persistent workspace.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-border bg-card">
      {/* table header */}
      <div className="hidden grid-cols-[2rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,7rem)_auto] gap-4 border-b border-border bg-muted/40 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground sm:grid">
        <span>#</span>
        <span>repository</span>
        <span>branch</span>
        <span>status</span>
        <span className="text-right">actions</span>
      </div>

      <div className="divide-y divide-border">
        {projects.map((project, index) => (
          <div
            key={project.projectId}
            style={{ animationDelay: `${index * 30}ms` }}
            className="animate-card-in"
          >
            <ProjectRow
              index={index}
              projectId={project.projectId}
              repoFullName={project.repoFullName}
              cloneUrl={project.cloneUrl}
              sandboxStatus={project.sandboxStatus}
              currentBranch={project.currentBranch}
              repoBranch={project.repoBranch}
              defaultBranch={project.defaultBranch}
              onDelete={() => onDelete(project.projectId)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
