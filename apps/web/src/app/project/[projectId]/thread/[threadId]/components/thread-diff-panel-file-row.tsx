"use client";

import { cn } from "@autopr/ui/lib/utils";

import { type ThreadDiffEntry, FileTypeIcon, pathParts } from "./thread-diff-panel-utils";

function InlineStatDots({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  if (total === 0) return null;
  const maxDots = 5;
  const addDots = Math.min(maxDots, Math.round((additions / Math.max(1, total)) * maxDots));
  const delDots = Math.min(maxDots - addDots, maxDots);

  return (
    <span className="flex items-center gap-px" aria-hidden="true">
      {Array.from({ length: addDots }).map((_, i) => (
        <span key={`a-${i}`} className="size-1.5 rounded-[1px] bg-emerald-500/70" />
      ))}
      {Array.from({ length: delDots }).map((_, i) => (
        <span key={`d-${i}`} className="size-1.5 rounded-[1px] bg-red-500/60" />
      ))}
      {Array.from({ length: Math.max(0, maxDots - addDots - delDots) }).map((_, i) => (
        <span key={`n-${i}`} className="size-1.5 rounded-[1px] bg-border/40" />
      ))}
    </span>
  );
}

function StatusIcon({ status, file }: { status: ThreadDiffEntry["status"]; file: string }) {
  const shared = "size-3.5 shrink-0";
  if (status === "added") {
    return <FilePlus2 className={cn(shared, "text-emerald-600 dark:text-emerald-400")} aria-hidden="true" />;
  }
  if (status === "deleted") {
    return <FileX2 className={cn(shared, "text-red-600 dark:text-red-400")} aria-hidden="true" />;
  }
  return <FileTypeIcon file={file} className={shared} />;
}

import { FilePlus2, FileX2 } from "lucide-react";

export function ThreadDiffFileRow({
  entry,
  active,
  onSelect,
  showTurn,
}: {
  entry: ThreadDiffEntry;
  active: boolean;
  onSelect: () => void;
  showTurn: boolean;
}) {
  const { name, dir } = pathParts(entry.file);

  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        title={entry.file}
        onClick={onSelect}
        className={cn(
          "group/row relative flex w-full min-w-0 items-center gap-2 rounded-[3px] px-2 py-[7px] text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40",
          active ? "bg-foreground/[0.05] dark:bg-foreground/[0.06]" : "hover:bg-foreground/[0.025] dark:hover:bg-foreground/[0.03]",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-1 left-0 w-0.5 rounded-full transition-all duration-200",
            active ? "bg-primary opacity-100" : "bg-transparent opacity-0 group-hover/row:bg-border/60 group-hover/row:opacity-100",
          )}
        />

        <StatusIcon status={entry.status} file={entry.file} />

        <span className="min-w-0 flex-1">
          <span className={cn("block truncate font-mono text-[11.5px] font-medium leading-tight tracking-tight", active ? "text-foreground" : "text-foreground/85")}>
            {name}
          </span>
          {dir ? <span className="mt-0.5 block truncate font-mono text-[9.5px] leading-tight text-muted-foreground/60">{dir}</span> : null}
        </span>

        <span className="flex shrink-0 items-center gap-2">
          {showTurn ? (
            <span className={cn("hidden rounded-[2px] border px-1 py-px font-mono text-[8.5px] uppercase leading-none tracking-[0.1em] sm:inline-flex", active ? "border-primary/30 text-primary" : "border-border/50 text-muted-foreground/60")}>{entry.turn}</span>
          ) : null}
          <InlineStatDots additions={entry.additions} deletions={entry.deletions} />
        </span>
      </button>
    </li>
  );
}
