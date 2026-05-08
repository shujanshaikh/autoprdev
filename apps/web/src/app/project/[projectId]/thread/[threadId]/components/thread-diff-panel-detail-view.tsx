"use client";

import { cn } from "@autopr/ui/lib/utils";
import { ToolDiffView } from "@/components/ai-elements/tool";

import {type ThreadDiffEntry, pathParts } from "./thread-diff-panel-utils";
import { ThreadDiffStatusIcon } from "./thread-diff-panel-status-icon";

export function ThreadDiffDetailView({ entry, showTurn }: { entry: ThreadDiffEntry; showTurn: boolean }) {
  const { name, dir } = pathParts(entry.file);

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-border/40 bg-background/95 px-3 py-2.5 backdrop-blur-lg">
        <div className="flex items-center gap-2">
          <ThreadDiffStatusIcon status={entry.status} file={entry.file} />
          <span className={cn("shrink-0 rounded-[2px] border px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.16em]", entry.status === "added" ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : entry.status === "deleted" ? "border-red-500/25 bg-red-500/8 text-red-700 dark:bg-red-500/10 dark:text-red-300" : "border-amber-500/25 bg-amber-500/8 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300")}>{entry.status}</span>
          {showTurn ? <span className="shrink-0 rounded-[2px] border border-border/50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70">Turn {entry.turn}</span> : null}
          <span className="ml-auto flex items-center gap-2 font-mono text-[10px] tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">+{entry.additions}</span>
            <span className="text-red-600 dark:text-red-400">−{entry.deletions}</span>
          </span>
        </div>
        <div className="mt-1.5 min-w-0">
          {dir ? <p className="truncate font-mono text-[10px] leading-snug text-muted-foreground/55">{dir}/</p> : null}
          <p className="break-all font-mono text-[12px] font-semibold leading-snug tracking-tight text-foreground">{name}</p>
        </div>
      </div>

      <div className="diff-panel-view p-2">
        <ToolDiffView key={entry.id} diff={entry.diff} pathLine={entry.file} />
      </div>
    </div>
  );
}
