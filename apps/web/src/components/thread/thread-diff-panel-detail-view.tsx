import { cn } from "@autopr/ui/lib/utils";
import { ToolDiffView } from "@/components/ai-elements/tool";

import { pathParts } from "#/lib/file-type-icon";
import { type ThreadDiffEntry } from "./thread-diff-panel-utils";
import { ThreadDiffStatusIcon } from "./thread-diff-panel-status-icon";

export function ThreadDiffDetailView({ entry, showTurn, compact = false }: { entry: ThreadDiffEntry; showTurn: boolean; compact?: boolean }) {
  const { name, dir } = pathParts(entry.file);
  const statusClass =
    entry.status === "added"
      ? "border-[color:color-mix(in_srgb,var(--cohere-deep-green)_25%,transparent)] bg-[color:var(--cohere-pale-green)] text-[color:var(--cohere-deep-green)] dark:border-[color:color-mix(in_srgb,var(--cohere-pale-green)_25%,transparent)] dark:bg-[color:var(--cohere-deep-green)] dark:text-[color:var(--cohere-pale-green)]"
      : entry.status === "deleted"
        ? "border-[color:color-mix(in_srgb,var(--cohere-coral)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--cohere-coral)_8%,transparent)] text-[color:var(--cohere-coral)]"
        : "border-[color:color-mix(in_srgb,var(--cohere-coral)_25%,transparent)] bg-[color:color-mix(in_srgb,var(--cohere-coral)_5%,transparent)] text-[color:var(--cohere-coral)]";

  return (
    <div className="flex min-h-full flex-col">
      {!compact ? <div className={cn("bg-card px-3 py-2.5", "sticky top-0 z-10 mx-2 mt-2 rounded-sm border border-border")}>
        <div className="flex items-center gap-2">
          <ThreadDiffStatusIcon status={entry.status} file={entry.file} />
          <span className={cn("shrink-0 rounded-[2px] border px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.16em]", statusClass)}>{entry.status}</span>
          {showTurn ? <span className="shrink-0 rounded-[2px] border border-border/50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70">Turn {entry.turn}</span> : null}
          <span className="ml-auto flex items-center gap-2 font-mono text-[10px] tabular-nums">
            <span className="text-[color:var(--cohere-deep-green)] dark:text-[color:var(--cohere-pale-green)]">+{entry.additions}</span>
            <span className="text-[color:var(--cohere-coral)]">−{entry.deletions}</span>
          </span>
        </div>
        <div className="mt-1.5 min-w-0">
          {dir ? <p className="truncate font-mono text-[10px] leading-snug text-muted-foreground/55">{dir}/</p> : null}
          <p className="break-all font-mono text-[12px] font-medium leading-snug tracking-tight text-foreground">{name}</p>
        </div>
      </div> : null}

      <div className="diff-panel-view px-2 pb-2">
        <ToolDiffView key={entry.id} diff={entry.diff} pathLine={compact ? name : entry.file} />
      </div>
    </div>
  );
}
