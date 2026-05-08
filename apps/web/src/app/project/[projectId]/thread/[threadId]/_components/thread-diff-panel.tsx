"use client";

import { Button } from "@autopr/ui/components/button";
import { cn } from "@autopr/ui/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  FileDiff,
  FileText,
  FilePlus2,
  FileX2,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import { ToolDiffView, type ToolDiffPayload } from "@/components/ai-elements/tool";

export type ThreadDiffEntry = {
  id: string;
  messageId: string;
  partIndex: number;
  turn: number;
  tool: "edit" | "write";
  file: string;
  patch: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified";
  oldContent?: string | null;
  newContent: string;
  diff: ToolDiffPayload;
};

type ThreadDiffPanelProps = {
  entries: ThreadDiffEntry[];
  selectedEntryId?: string;
  onSelectEntry: (id: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading?: boolean;
};

/* ─── Utilities ───────────────────────────────────────────────────────── */

function pathParts(path: string): { name: string; dir: string } {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "") || path;
  const index = normalized.lastIndexOf("/");
  if (index === -1) {
    return { name: normalized, dir: "" };
  }
  return {
    name: normalized.slice(index + 1) || normalized,
    dir: normalized.slice(0, index),
  };
}

function statusLabel(status: ThreadDiffEntry["status"]): string {
  if (status === "added") return "Added";
  if (status === "deleted") return "Deleted";
  return "Modified";
}


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
  const selectedEntry =
    entries.find((entry) => entry.id === selectedEntryId) ?? entries.at(-1);
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
    return { additions, deletions, files: new Set(entries.map((e) => e.file)).size };
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
        const nextWidth = Math.min(
          MAX_PANEL_WIDTH,
          Math.max(MIN_PANEL_WIDTH, startWidth + startX - moveEvent.clientX),
        );
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
        style={
          { "--thread-diff-width": `${panelWidth}px` } as CSSProperties &
            Record<"--thread-diff-width", string>
        }
      >
        {/* Left edge gradient + resize handle */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-px bg-gradient-to-b from-transparent via-border/60 to-transparent"
        />

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
              {entries.length > 0 ? (
                <span className="absolute -right-1 -top-1 inline-flex size-3.5 items-center justify-center bg-foreground font-mono text-[8px] font-semibold leading-none text-background">
                  {entries.length > 99 ? "99" : entries.length}
                </span>
              ) : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
                Changes
              </p>
              <p className="truncate text-[13px] font-semibold leading-tight tracking-tight">
                {entries.length === 0
                  ? isLoading
                    ? "Computing changes…"
                    : "No changes yet"
                  : `${totals.files} ${totals.files === 1 ? "file" : "files"} changed`}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 lg:hidden"
              onClick={() => onOpenChange(false)}
              aria-label="Close changes panel"
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          </div>

          {entries.length > 0 ? (
            <DiffStatBar additions={totals.additions} deletions={totals.deletions} />
          ) : null}
        </header>

        {showEmpty ? (
          <EmptyState />
        ) : showLoadingList ? (
          <LoadingList />
        ) : (
          <div className={cn(
            "grid min-h-0 flex-1 overflow-hidden transition-[grid-template-rows] duration-200",
            isFileListCollapsed
              ? "grid-rows-[0fr_minmax(0,1fr)]"
              : "grid-rows-[minmax(96px,min(200px,30%))_minmax(0,1fr)]",
          )}>
            {/* File list */}
            <div className="relative min-h-0 overflow-hidden border-b border-border/40">
              {/* Collapse toggle */}
              <button
                type="button"
                className="absolute right-2 top-1.5 z-10 flex size-5 items-center justify-center text-muted-foreground/60 transition hover:text-foreground"
                onClick={() => setIsFileListCollapsed((v) => !v)}
                aria-label={isFileListCollapsed ? "Expand file list" : "Collapse file list"}
              >
                {isFileListCollapsed ? (
                  <ChevronRight className="size-3" />
                ) : (
                  <ChevronDown className="size-3" />
                )}
              </button>

              <ul
                role="listbox"
                aria-label="Changed files"
                className="minimal-scrollbar h-full min-h-0 overflow-y-auto bg-muted/5 px-1.5 py-1.5"
              >
                {entries.map((entry) => {
                  const active = entry.id === selectedEntry?.id;
                  return (
                    <FileRow
                      key={entry.id}
                      entry={entry}
                      active={active}
                      showTurn={(fileEntryCounts.get(entry.file) ?? 0) > 1}
                      onSelect={() => onSelectEntry(entry.id)}
                    />
                  );
                })}
              </ul>
            </div>

            {/* Diff detail view */}
            <div className="minimal-scrollbar relative min-h-0 overflow-auto overscroll-contain bg-background">
              {selectedEntry ? (
                <DetailView
                  entry={selectedEntry}
                  showTurn={(fileEntryCounts.get(selectedEntry.file) ?? 0) > 1}
                />
              ) : isLoading ? (
                <LoadingDiff />
              ) : null}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}


function DiffStatBar({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  const total = Math.max(1, additions + deletions);
  const addPct = (additions / total) * 100;
  const delPct = (deletions / total) * 100;

  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-[3px] flex-1 overflow-hidden rounded-full bg-border/30">
        <span
          className="block h-full rounded-l-full bg-emerald-500/75 transition-[width] duration-500 ease-out"
          style={{ width: `${addPct}%` }}
        />
        <span
          className="block h-full rounded-r-full bg-red-500/60 transition-[width] duration-500 ease-out"
          style={{ width: `${delPct}%` }}
        />
      </div>
      <span className="font-mono text-[10px] tabular-nums text-emerald-600 dark:text-emerald-400">
        +{additions}
      </span>
      <span className="font-mono text-[10px] tabular-nums text-red-600 dark:text-red-400">
        −{deletions}
      </span>
    </div>
  );
}


function StatusIcon({ status }: { status: ThreadDiffEntry["status"] }) {
  const shared = "size-3.5 shrink-0";
  if (status === "added") {
    return <FilePlus2 className={cn(shared, "text-emerald-600 dark:text-emerald-400")} aria-hidden="true" />;
  }
  if (status === "deleted") {
    return <FileX2 className={cn(shared, "text-red-600 dark:text-red-400")} aria-hidden="true" />;
  }
  return <FileText className={cn(shared, "text-amber-600 dark:text-amber-400")} aria-hidden="true" />;
}

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

function FileRow({
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
          active
            ? "bg-foreground/[0.05] dark:bg-foreground/[0.06]"
            : "hover:bg-foreground/[0.025] dark:hover:bg-foreground/[0.03]",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-1 left-0 w-0.5 rounded-full transition-all duration-200",
            active
              ? "bg-primary opacity-100"
              : "bg-transparent opacity-0 group-hover/row:bg-border/60 group-hover/row:opacity-100",
          )}
        />

        <StatusIcon status={entry.status} />

        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate font-mono text-[11.5px] font-medium leading-tight tracking-tight",
              active ? "text-foreground" : "text-foreground/85",
            )}
          >
            {name}
          </span>
          {dir ? (
            <span className="mt-0.5 block truncate font-mono text-[9.5px] leading-tight text-muted-foreground/60">
              {dir}
            </span>
          ) : null}
        </span>

        <span className="flex shrink-0 items-center gap-2">
          {showTurn ? (
            <span
              className={cn(
                "hidden rounded-[2px] border px-1 py-px font-mono text-[8.5px] uppercase leading-none tracking-[0.1em] sm:inline-flex",
                active
                  ? "border-primary/30 text-primary"
                  : "border-border/50 text-muted-foreground/60",
              )}
            >
              {entry.turn}
            </span>
          ) : null}
          <InlineStatDots additions={entry.additions} deletions={entry.deletions} />
        </span>
      </button>
    </li>
  );
}


function DetailView({ entry, showTurn }: { entry: ThreadDiffEntry; showTurn: boolean }) {
  const { name, dir } = pathParts(entry.file);

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-border/40 bg-background/95 px-3 py-2.5 backdrop-blur-lg">
        {/* Top row: status + stats */}
        <div className="flex items-center gap-2">
          <StatusIcon status={entry.status} />
          <span
            className={cn(
              "shrink-0 rounded-[2px] border px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.16em]",
              entry.status === "added"
                ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                : entry.status === "deleted"
                  ? "border-red-500/25 bg-red-500/8 text-red-700 dark:bg-red-500/10 dark:text-red-300"
                  : "border-amber-500/25 bg-amber-500/8 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
            )}
          >
            {statusLabel(entry.status)}
          </span>
          {showTurn ? (
            <span className="shrink-0 rounded-[2px] border border-border/50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70">
              Turn {entry.turn}
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-2 font-mono text-[10px] tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">
              +{entry.additions}
            </span>
            <span className="text-red-600 dark:text-red-400">
              −{entry.deletions}
            </span>
          </span>
        </div>


        <div className="mt-1.5 min-w-0">
          {dir ? (
            <p className="truncate font-mono text-[10px] leading-snug text-muted-foreground/55">
              {dir}/
            </p>
          ) : null}
          <p className="break-all font-mono text-[12px] font-semibold leading-snug tracking-tight text-foreground">
            {name}
          </p>
        </div>
      </div>


      <div className="diff-panel-view p-2">
        <ToolDiffView key={entry.id} diff={entry.diff} pathLine={entry.file} />
      </div>
    </div>
  );
}



function EmptyState() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="relative inline-flex size-14 items-center justify-center">
        <span
          aria-hidden="true"
          className="absolute inset-0 border border-dashed border-border/50 opacity-70"
        />
        <span
          aria-hidden="true"
          className="absolute inset-1 border border-dashed border-border/30 opacity-40"
        />
        <FileDiff className="size-5 text-muted-foreground/50" aria-hidden="true" />
      </div>
      <div className="space-y-1.5">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-muted-foreground/70">
          Awaiting changes
        </p>
        <p className="max-w-[240px] font-mono text-[11px] leading-relaxed text-muted-foreground/50">
          File edits from the agent will surface here as they happen.
        </p>
      </div>
    </div>
  );
}



function LoadingList() {
  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(120px,min(240px,38%))_minmax(0,1fr)] overflow-hidden">
      <div className="minimal-scrollbar min-h-0 overflow-hidden border-b border-border/40 px-2 py-2">
        <ul className="space-y-px">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} delay={i * 80} />
          ))}
        </ul>
      </div>
      <LoadingDiff />
    </div>
  );
}

function SkeletonRow({ delay }: { delay: number }) {
  return (
    <li
      className="flex items-center gap-2.5 px-2 py-2.5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="size-4 shrink-0 animate-pulse rounded-[2px] bg-muted/80" />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span
          className="h-2.5 animate-pulse rounded-sm bg-muted"
          style={{ width: `${55 + ((delay * 7) % 30)}%` }}
        />
        <span
          className="h-2 animate-pulse rounded-sm bg-muted/60"
          style={{ width: `${30 + ((delay * 5) % 25)}%` }}
        />
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className="size-1.5 animate-pulse rounded-[1px] bg-muted/60" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </span>
    </li>
  );
}

function LoadingDiff() {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-border/40 px-3 pb-2.5 pt-2.5">
        <div className="flex items-center gap-2">
          <span className="size-3.5 animate-pulse rounded-[2px] bg-muted" />
          <span className="h-3.5 w-16 animate-pulse rounded-sm bg-muted" />
          <span className="ml-auto h-2.5 w-14 animate-pulse rounded-sm bg-muted" />
        </div>
        <div className="mt-2 space-y-1.5">
          <span className="block h-2 w-2/3 animate-pulse rounded-sm bg-muted/60" />
          <span className="block h-2.5 w-4/5 animate-pulse rounded-sm bg-muted" />
        </div>
      </div>
      <div className="space-y-1.5 px-3 py-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <span
            key={i}
            className="block h-2.5 animate-pulse rounded-sm bg-muted/70"
            style={{
              width: `${[92, 78, 60, 84, 45, 70, 88, 52, 66][i]}%`,
              animationDelay: `${i * 70}ms`,
            }}
          />
        ))}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 border-t border-border/40 bg-background/90 px-3 py-2.5 backdrop-blur-sm"
      >
        <span className="relative inline-flex size-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground/30" />
          <span className="relative inline-flex size-1.5 rounded-full bg-foreground/70" />
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
          Computing diff
        </span>
      </div>
    </div>
  );
}
