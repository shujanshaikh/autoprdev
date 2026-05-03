"use client";

import { cn } from "@autopr/ui/lib/utils";
import { ArrowUpRight, GitBranch, Trash2 } from "lucide-react";
import Link from "next/link";

import { statusStyles, type SandboxStatus } from "./types";

interface ProjectRowProps {
  index: number;
  projectId: string;
  repoFullName: string;
  cloneUrl: string;
  sandboxStatus: SandboxStatus;
  currentBranch?: string | null;
  repoBranch?: string | null;
  defaultBranch?: string | null;
  onDelete: () => void;
}

export function ProjectRow({
  index,
  projectId,
  repoFullName,
  cloneUrl,
  sandboxStatus,
  currentBranch,
  repoBranch,
  defaultBranch,
  onDelete,
}: ProjectRowProps) {
  const branch = currentBranch ?? repoBranch ?? defaultBranch ?? "main";
  const styles = statusStyles(sandboxStatus);
  const [owner, name] = repoFullName.split("/");

  return (
    <div
      className={cn(
        "group relative grid items-center gap-4 px-4 py-2 transition",
        "grid-cols-[2rem_1fr_auto] sm:grid-cols-[2rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,7rem)_auto]",
        "hover:bg-muted/40",
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
        {String(index + 1).padStart(2, "0")}
      </span>

      <Link
        href={`/project/${projectId}`}
        className="block min-w-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
      >
        <div className="flex items-baseline gap-1.5 font-mono text-xs">
          <span className="truncate text-muted-foreground">
            {owner}
            <span className="opacity-50">/</span>
          </span>
          <span className="truncate font-semibold text-foreground transition group-hover:underline group-hover:underline-offset-4">
            {name}
          </span>
        </div>
      </Link>

      {/* branch (sm+) */}
      <div className="hidden min-w-0 sm:block">
        <span className="inline-flex max-w-full items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground">
          <GitBranch className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{branch}</span>
        </span>
      </div>

      <div className="hidden sm:block">
        <span
          className={cn(
            "inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em]",
            styles.label,
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              styles.dot,
              sandboxStatus === "creating" && "animate-pulse",
            )}
          />
          {sandboxStatus}
        </span>
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
          href={`/project/${projectId}`}
          className="inline-flex h-7 items-center gap-1.5 border border-transparent px-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground transition hover:border-foreground hover:bg-foreground hover:text-background"
        >
          open
          <ArrowUpRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}
