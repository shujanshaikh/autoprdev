"use client";

import { Button } from "@autopr/ui/components/button";
import { cn } from "@autopr/ui/lib/utils";
import { ChevronDown, ChevronRight, FileDiff, X } from "lucide-react";
import { useCallback, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import { DiffStatBar } from "../components/thread-diff-panel-stat-bar";
import { ThreadDiffDetailView } from "../components/thread-diff-panel-detail-view";
import { ThreadDiffEmptyState, ThreadDiffLoadingList } from "../components/thread-diff-panel-states";
import { ThreadDiffFileRow } from "../components/thread-diff-panel-file-row";
import type { ThreadDiffEntry } from "../components/thread-diff-panel-utils";

type ThreadDiffPanelProps = {
  entries: ThreadDiffEntry[];
  selectedEntryId?: string;
  onSelectEntry: (id: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading?: boolean;
};

const MIN_PANEL_WIDTH = 380;
const MAX_PANEL_WIDTH = 860;
const DEFAULT_PANEL_WIDTH = 480;

export function ThreadDiffPanel({
  entries,
  selectedEntryId,
  onSelectEntry,
  open,
  onOpenChange,
  isLoading = false,
}: ThreadDiffPanelProps) {
  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) ?? entries.at(-1);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [isFileListCollapsed, setIsFileListCollapsed] = useState(false);
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
          "fixed inset-y-0 right-0 z-40 flex h-full max-h-full w-[min(94vw,560px)] min-w-0 flex-col border-l border-border/50 bg-background transition-transform duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] lg:static lg:z-auto lg:w-[var(--thread-diff-width)] lg:shrink-0",
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

        <header className="relative flex shrink-0 flex-col gap-2 border-b border-border/40 bg-background px-4 pb-3 pt-3.5">
          <div className="flex items-center gap-2.5">
            <span className="relative inline-flex size-7 items-center justify-center border border-border/50 bg-muted/20">
              <FileDiff className="size-3.5 text-foreground/80" aria-hidden="true" />
              {entries.length > 0 ? <span className="absolute -right-1 -top-1 inline-flex size-3.5 items-center justify-center bg-foreground font-mono text-[8px] font-semibold leading-none text-background">{entries.length > 99 ? "99" : entries.length}</span> : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">Changes</p>
              <p className="truncate text-[13px] font-semibold leading-tight tracking-tight">
                {entries.length === 0 ? (isLoading ? "Computing changes…" : "No changes yet") : `${totals.files} ${totals.files === 1 ? "file" : "files"} changed`}
              </p>
            </div>
            <Button type="button" variant="ghost" size="icon" className="size-7 lg:hidden" onClick={() => onOpenChange(false)} aria-label="Close changes panel">
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          </div>

          {entries.length > 0 ? <DiffStatBar additions={totals.additions} deletions={totals.deletions} /> : null}
        </header>

        {showEmpty ? (
          <ThreadDiffEmptyState />
        ) : showLoadingList ? (
          <ThreadDiffLoadingList />
        ) : (
          <div className={cn("grid min-h-0 flex-1 overflow-hidden transition-[grid-template-rows] duration-200", isFileListCollapsed ? "grid-rows-[0fr_minmax(0,1fr)]" : "grid-rows-[minmax(96px,min(200px,30%))_minmax(0,1fr)]")}>
            <div className="relative min-h-0 overflow-hidden border-b border-border/40">
              <button
                type="button"
                className="absolute right-2 top-1.5 z-10 flex size-5 items-center justify-center text-muted-foreground/60 transition hover:text-foreground"
                onClick={() => setIsFileListCollapsed((value) => !value)}
                aria-label={isFileListCollapsed ? "Expand file list" : "Collapse file list"}
              >
                {isFileListCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
              </button>

              <ul role="listbox" aria-label="Changed files" className="minimal-scrollbar h-full min-h-0 overflow-y-auto bg-muted/5 px-1.5 py-1.5">
                {entries.map((entry) => {
                  const active = entry.id === selectedEntry?.id;
                  return <ThreadDiffFileRow key={entry.id} entry={entry} active={active} showTurn={(fileEntryCounts.get(entry.file) ?? 0) > 1} onSelect={() => onSelectEntry(entry.id)} />;
                })}
              </ul>
            </div>

            <div className="minimal-scrollbar relative min-h-0 overflow-auto overscroll-contain bg-background">
              {selectedEntry ? <ThreadDiffDetailView entry={selectedEntry} showTurn={(fileEntryCounts.get(selectedEntry.file) ?? 0) > 1} /> : isLoading ? <ThreadDiffLoadingList /> : null}
            </div>
          </div>
        )}
      </aside>
    </>
    );
  }
