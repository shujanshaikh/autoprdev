import { cn } from "@autopr/ui/lib/utils";

import { FileTypeIcon, pathParts } from "#/lib/file-type-icon";
import { type ThreadDiffEntry } from "./thread-diff-panel-utils";

function InlineStatDots({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  if (total === 0) return null;
  const maxDots = 5;
  const addDots = Math.min(maxDots, Math.round((additions / Math.max(1, total)) * maxDots));
  const delDots = Math.min(maxDots - addDots, maxDots);

  return (
    <span className="flex items-center gap-px" aria-hidden="true">
      {Array.from({ length: addDots }).map((_, i) => (
        <span key={`a-${i}`} className="size-1.5 rounded-[1px] bg-[color:var(--cohere-deep-green)] opacity-70" />
      ))}
      {Array.from({ length: delDots }).map((_, i) => (
        <span key={`d-${i}`} className="size-1.5 rounded-[1px] bg-[color:var(--cohere-coral)] opacity-70" />
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
    return <FilePlus2 className={cn(shared, "text-[color:var(--cohere-deep-green)] dark:text-[color:var(--cohere-pale-green)]")} aria-hidden="true" />;
  }
  if (status === "deleted") {
    return <FileX2 className={cn(shared, "text-[color:var(--cohere-coral)]")} aria-hidden="true" />;
  }
  return <FileTypeIcon file={file} className={shared} />;
}

import { Check, ChevronDown, ChevronRight, FilePlus2, FileX2 } from "lucide-react";

export function ThreadDiffFileRow({
  entry,
  active,
  expanded,
  onSelect,
  viewed,
  onViewedChange,
  showTurn,
}: {
  entry: ThreadDiffEntry;
  active: boolean;
  expanded: boolean;
  onSelect: () => void;
  viewed: boolean;
  onViewedChange: (viewed: boolean) => void;
  showTurn: boolean;
}) {
  const { name } = pathParts(entry.file);

  return (
    <div className="group/row relative flex items-stretch">
      <button
        type="button"
        role="option"
        aria-selected={active}
        title={entry.file}
        onClick={onSelect}
        className={cn(
          "relative flex min-w-0 flex-1 items-center gap-2 rounded-l-sm py-2 pr-1 pl-2.5 text-left transition-colors duration-150 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--cohere-form-focus)]",
          active ? "bg-[color:var(--project-selected)]" : "bg-card hover:bg-[color:var(--project-panel-soft)]",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-1 left-0 w-0.5 transition-all duration-200",
            active ? "bg-[color:var(--project-selected-strong)] opacity-100" : "bg-transparent opacity-0 group-hover/row:bg-border group-hover/row:opacity-100",
          )}
        />

        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/70">
          {expanded ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}
        </span>
        <StatusIcon status={entry.status} file={entry.file} />

        <span className="min-w-0 flex-1">
          <span className={cn("block truncate font-mono text-[11px] font-medium leading-tight tracking-tight", active ? "text-foreground" : "text-foreground/85")}>
            {name}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2">
          {showTurn ? (
            <span className={cn("hidden rounded-[2px] border px-1 py-px font-mono text-[8.5px] uppercase leading-none tracking-[0.1em] sm:inline-flex", active ? "border-[color:var(--project-selected-strong)] text-[color:var(--project-selected-strong)]" : "border-border text-muted-foreground/60")}>{entry.turn}</span>
          ) : null}
          <InlineStatDots additions={entry.additions} deletions={entry.deletions} />
        </span>
      </button>
      <button
        type="button"
        role="checkbox"
        aria-checked={viewed}
        aria-label={viewed ? `Mark ${entry.file} unviewed` : `Mark ${entry.file} viewed`}
        title={viewed ? "Mark unviewed" : "Mark viewed"}
        onClick={() => onViewedChange(!viewed)}
        className={cn(
          "m-1.5 ml-0 inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cohere-form-focus)]",
          viewed
            ? "border-[color:var(--project-selected-strong)] bg-[color:var(--project-selected-strong)] text-[color:var(--framer-on-primary)] hover:opacity-[0.85]"
            : "border-border bg-background text-transparent hover:border-[color:var(--project-selected-strong)] hover:text-[color:var(--project-selected-strong)]",
        )}
      >
        <Check className="size-4" strokeWidth={2.5} aria-hidden="true" />
      </button>
    </div>
  );
}
