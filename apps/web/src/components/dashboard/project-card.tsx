import { api } from "@autopr/backend/convex/_generated/api";
import { cn } from "@autopr/ui/lib/utils";
import { useAction } from "convex/react";
import { ArrowUpRight, GitBranch, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { statusStyles, type SandboxRuntimeStatus, type SandboxStatus } from "./types";

interface ProjectRowProps {
  index: number;
  projectId: string;
  repoFullName: string;
  cloneUrl: string;
  sandboxStatus: SandboxStatus;
  sandboxRuntimeStatus?: SandboxRuntimeStatus | null;
  currentBranch?: string | null;
  repoBranch?: string | null;
  defaultBranch?: string | null;
  onDelete: () => void;
}

export function ProjectRow({
  index,
  projectId,
  repoFullName,
  sandboxStatus,
  sandboxRuntimeStatus,
  currentBranch,
  repoBranch,
  defaultBranch,
  onDelete,
}: ProjectRowProps) {
  const branch = currentBranch ?? repoBranch ?? defaultBranch ?? "main";
  const styles = statusStyles(sandboxStatus);
  const [runtimeStatus, setRuntimeStatus] = useState<SandboxRuntimeStatus | undefined>(sandboxRuntimeStatus ?? undefined);
  const getSandboxRuntimeStatus = useAction(api.projectActions.getSandboxRuntimeStatus);
  const [owner, name] = repoFullName.split("/");

  useEffect(() => {
    setRuntimeStatus(sandboxRuntimeStatus ?? undefined);
  }, [sandboxRuntimeStatus]);

  useEffect(() => {
    if (sandboxStatus !== "ready") return;
    let cancelled = false;

    void getSandboxRuntimeStatus({ projectId })
      .then((result) => {
        if (!cancelled) setRuntimeStatus(result.status);
      })
      .catch(() => {
        if (!cancelled) setRuntimeStatus("unknown");
      });

    return () => {
      cancelled = true;
    };
  }, [getSandboxRuntimeStatus, projectId, sandboxStatus]);

  return (
    <div
      className={cn(
        "group relative grid items-center gap-4 px-4 py-2 transition",
        "grid-cols-[2rem_1fr_auto] sm:grid-cols-[2rem_minmax(0,1.4fr)_minmax(0,11rem)_auto]",
        "hover:bg-muted/40",
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
        {String(index + 1).padStart(2, "0")}
      </span>

      <Link
        to="/project/$projectId"
        params={{ projectId }}
        className="block min-w-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <p className="truncate font-mono text-xs">
          <span className="text-muted-foreground">{owner}</span>
          <span className="opacity-50">/</span>
          <span className="font-semibold text-foreground transition group-hover:underline group-hover:underline-offset-4">
            {name}
          </span>
        </p>
      </Link>

      <div className="hidden min-w-0 flex-col gap-1.5 sm:flex">
        <div className="grid min-w-0 grid-cols-[0.75rem_minmax(0,1fr)] items-center gap-x-1.5 font-mono text-[11px] leading-none text-muted-foreground">
          <GitBranch className="size-3 shrink-0 self-center" aria-hidden="true" />
          <span className="min-w-0 truncate">{branch}</span>
        </div>
        <div
          className={cn(
            "grid min-w-0 grid-cols-[0.75rem_minmax(0,1fr)] items-center gap-x-1.5 font-mono text-[10px] uppercase leading-none tracking-[0.2em]",
            styles.label,
          )}
        >
          <span className="flex size-3 shrink-0 items-center justify-center" aria-hidden>
            <span className="relative flex size-2.5 items-center justify-center bg-amber-900/65 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]">
              <span
                className={cn(
                  "absolute -bottom-1 h-0.5 w-3 rounded-full",
                  runtimeStatus === "started" ? "bg-emerald-500" : runtimeStatus === "stopped" ? "bg-zinc-500" : styles.dot,
                  sandboxStatus === "creating" && "animate-pulse",
                )}
              />
            </span>
          </span>
          <span className="min-w-0 truncate">
            {sandboxStatus}
            {sandboxStatus === "ready" && runtimeStatus ? ` / vm ${runtimeStatus}` : ""}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex size-7 items-center justify-center text-muted-foreground/60 transition hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Delete ${repoFullName}`}
        >
          <Trash2 className="size-3.5" />
        </button>
        <Link
          to="/project/$projectId"
          params={{ projectId }}
          className="inline-flex h-7 items-center gap-1.5 border border-transparent px-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground transition hover:border-primary hover:bg-primary hover:text-primary-foreground"
        >
          open
          <ArrowUpRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}
