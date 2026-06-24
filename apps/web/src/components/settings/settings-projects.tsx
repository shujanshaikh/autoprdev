import { Link } from "@tanstack/react-router";
import { GitBranch, Loader2 } from "lucide-react";
import { cn } from "@autopr/ui/lib/utils";
import { statusStyles } from "#/components/dashboard/types";
import type { WorkspaceProject } from "./settings-dialog";

interface SettingsProjectsProps {
  projects: WorkspaceProject[] | undefined;
}

function projectParts(repoFullName: string) {
  const [owner, ...rest] = repoFullName.split("/");
  return {
    owner: rest.length > 0 ? owner : undefined,
    name: rest.length > 0 ? rest.join("/") : repoFullName,
  };
}

function formatAge(timestamp?: number) {
  if (!timestamp) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

export function SettingsProjects({ projects }: SettingsProjectsProps) {
  return (
    <section className="min-w-0 border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 min-[420px]:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground min-[420px]:tracking-[0.24em]">
            Recent projects
          </h2>
          {projects !== undefined && (
            <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center bg-muted px-1 font-mono text-[9px] tabular-nums text-muted-foreground">
              {projects.length}
            </span>
          )}
        </div>
        <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/65 min-[380px]:inline">
          status
        </span>
      </div>

      {projects === undefined ? (
        <div className="flex min-h-28 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2
            className="size-4 animate-spin"
            aria-hidden="true"
          />
          Loading projects
        </div>
      ) : projects.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">No sandboxes yet.</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Create a project to get started.
          </p>
        </div>
      ) : (
        <div>
          {projects.slice(0, 8).map((project) => (
            <ProjectRow key={project.projectId} project={project} />
          ))}
        </div>
      )}
    </section>
  );
}

function ProjectRow({ project }: { project: WorkspaceProject }) {
  const { owner, name } = projectParts(project.repoFullName);
  const branch =
    project.currentBranch ?? project.repoBranch ?? project.defaultBranch ?? "main";
  const styles = statusStyles(project.sandboxStatus);

  return (
    <Link
      to="/project/$projectId"
      params={{ projectId: project.projectId }}
      className="group grid min-h-12 grid-cols-[minmax(0,1fr)] gap-1.5 border-b border-border/60 px-3 py-2.5 transition last:border-b-0 hover:bg-muted/45 min-[420px]:grid-cols-[minmax(0,1fr)_auto] min-[420px]:items-center min-[420px]:gap-3 min-[420px]:py-2 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,0.9fr)_7rem]"
    >
      <div className="min-w-0">
        <p className="truncate text-[13px]">
          {owner ? (
            <>
              <span className="text-muted-foreground">{owner}</span>
              <span className="text-muted-foreground/45">/</span>
            </>
          ) : null}
          <span className="font-semibold text-foreground group-hover:underline group-hover:underline-offset-4">
            {name}
          </span>
        </p>
        <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60 sm:hidden">
          {branch}
        </p>
      </div>
      <div className="hidden min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground sm:flex">
        <GitBranch className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{branch}</span>
      </div>
      <div className="min-w-0 flex items-center justify-start gap-2 min-[420px]:justify-end">
        <span
          className={cn(
            "max-w-28 truncate font-mono text-[10px] uppercase tracking-[0.16em]",
            styles.label,
          )}
        >
          {project.sandboxStatus}
        </span>
        <span className="hidden font-mono text-[10px] tabular-nums text-muted-foreground/55 sm:inline">
          {formatAge(project.lastOpenedAt ?? project.updatedAt)}
        </span>
      </div>
    </Link>
  );
}
