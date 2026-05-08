"use client";

import { Button } from "@autopr/ui/components/button";
import { cn } from "@autopr/ui/lib/utils";
import { FileDiff, GitBranch, X } from "lucide-react";
import { useCallback, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import { DiffStatBar } from "../components/thread-diff-panel-stat-bar";
import { ThreadDiffDetailView } from "../components/thread-diff-panel-detail-view";
import { ThreadDiffEmptyState, ThreadDiffLoadingList } from "../components/thread-diff-panel-states";
import { ThreadDiffFileRow } from "../components/thread-diff-panel-file-row";
import type { ThreadDiffEntry } from "../components/thread-diff-panel-utils";

export type ThreadDiffPanelProps = {
  entries: ThreadDiffEntry[];
  selectedEntryId?: string;
  onSelectEntry: (id: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading?: boolean;
};

const MIN_PANEL_WIDTH = 380;
const MAX_PANEL_WIDTH = 860;
const DEFAULT_PANEL_WIDTH = 640;

export function ThreadDiffPanel({
  entries,
  selectedEntryId,
  onSelectEntry,
  open,
  onOpenChange,
  isLoading = false,
}: ThreadDiffPanelProps) {
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [expandedEntryId, setExpandedEntryId] = useState<string | undefined>();
  const fileEntryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      counts.set(entry.file, (counts.get(entry.file) ?? 0) + 1);
    }
    return counts;
  }, [entries]);

  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const entry of entries) {
      additions += entry.additions;
      deletions += entry.deletions;
    }
    return { additions, deletions, files: new Set(entries.map((entry) => entry.file)).size };
  }, [entries]);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();

      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = panelWidth;
      const target = event.currentTarget;

      target.setPointerCapture(pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const nextWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, startWidth + startX - moveEvent.clientX));
        setPanelWidth(nextWidth);
      };

      const stopResize = () => {
        target.releasePointerCapture(pointerId);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize);
      window.addEventListener("pointercancel", stopResize);
    },
    [panelWidth],
  );

  const showLoadingList = isLoading && entries.length === 0;
  const showEmpty = !isLoading && entries.length === 0;

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close changes panel"
          className="fixed inset-0 z-30 bg-background/60 backdrop-blur-[6px] lg:hidden"
          onClick={() => onOpenChange(false)}
        />
      ) : null}
      <aside
        id="thread-changes-panel"
        aria-hidden={!open}
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex h-full max-h-full w-[min(96vw,720px)] min-w-0 flex-col border-l border-border/50 bg-background transition-transform duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] lg:static lg:z-auto lg:w-[var(--thread-diff-width)] lg:shrink-0",
          open ? "translate-x-0" : "translate-x-full lg:hidden",
        )}
        style={{ "--thread-diff-width": `${panelWidth}px` } as CSSProperties & Record<"--thread-diff-width", string>}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-px bg-gradient-to-b from-transparent via-border/60 to-transparent" />

        <button
          type="button"
          aria-label="Resize changes panel"
          className="group/resize absolute inset-y-0 left-0 z-10 hidden w-2.5 -translate-x-1.5 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none lg:flex"
          onPointerDown={startResize}
        >
          <span className="block h-12 w-0.5 rounded-full bg-border/50 transition-all duration-200 group-hover/resize:h-20 group-hover/resize:bg-primary/50 group-focus-visible/resize:bg-primary" />
        </button>

        <header className="relative flex shrink-0 flex-col border-b border-border/55 bg-background">
          <div className="flex h-10 items-center gap-1 border-b border-border/45 px-3">
            <button type="button" className="inline-flex h-7 items-center gap-1.5 border border-border/60 bg-muted/50 px-2.5 text-xs font-medium text-foreground">
              <GitBranch className="size-3.5" aria-hidden="true" />
              Git
            </button>
          </div>

          <div className="flex h-10 items-center gap-2 border-b border-border/45 px-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="inline-flex size-6 items-center justify-center border border-border/60 bg-muted/40">
                <FileDiff className="size-3.5 text-foreground/80" aria-hidden="true" />
              </span>
              <p className="truncate text-sm font-medium text-foreground">Thread changes</p>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{totals.files} files</span>
            </div>
            {entries.length > 0 ? (
              <div className="flex shrink-0 items-center gap-2 font-mono text-xs tabular-nums">
                <span className="text-emerald-500">+{totals.additions}</span>
                <span className="text-red-400">−{totals.deletions}</span>
              </div>
            ) : null}
            <Button type="button" variant="ghost" size="icon" className="size-7 lg:hidden" onClick={() => onOpenChange(false)} aria-label="Close changes panel">
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          </div>

          {entries.length > 0 ? (
            <div className="flex h-8 items-center px-3">
              <DiffStatBar additions={totals.additions} deletions={totals.deletions} />
            </div>
          ) : null}
        </header>

        {showEmpty ? (
          <ThreadDiffEmptyState />
        ) : showLoadingList ? (
          <ThreadDiffLoadingList />
        ) : (
          <div className="minimal-scrollbar min-h-0 flex-1 overflow-auto bg-muted/5 p-2">
            <div role="listbox" aria-label="Changed files" className="flex min-h-0 flex-col gap-1.5">
              {entries.map((entry) => {
                const expanded = expandedEntryId === entry.id;
                return (
                  <div key={entry.id} className="overflow-hidden rounded-md border border-border/45 bg-background/60">
                    <ThreadDiffFileRow
                      entry={entry}
                      active={expanded}
                      expanded={expanded}
                      showTurn={(fileEntryCounts.get(entry.file) ?? 0) > 1}
                      onSelect={() => {
                        onSelectEntry(entry.id);
                        setExpandedEntryId((current) => (current === entry.id ? undefined : entry.id));
                      }}
                    />
                    {expanded ? (
                      <div className="border-t border-border/45 bg-background">
                        <ThreadDiffDetailView entry={entry} showTurn={(fileEntryCounts.get(entry.file) ?? 0) > 1} compact />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </aside>
    </>
    );
  }
