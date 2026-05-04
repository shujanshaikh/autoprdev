"use client";

import { Button } from "@autopr/ui/components/button";
import { cn } from "@autopr/ui/lib/utils";
import { FileDiff, GitCommitVertical, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

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

function statusGlyph(status: ThreadDiffEntry["status"]): string {
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  return "M";
}

const MIN_PANEL_WIDTH = 340;
const MAX_PANEL_WIDTH = 760;
const DEFAULT_PANEL_WIDTH = 420;

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
    return { additions, deletions };
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
          className="fixed inset-0 z-30 bg-background/70 backdrop-blur-sm lg:hidden"
          onClick={() => onOpenChange(false)}
        />
      ) : null}
      <aside
        id="thread-changes-panel"
        aria-hidden={!open}
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex h-full max-h-full w-[min(94vw,520px)] min-w-0 flex-col border-l border-border/60 bg-background shadow-2xl transition-transform duration-200 lg:static lg:z-auto lg:w-[var(--thread-diff-width)] lg:shrink-0 lg:shadow-none",
          open ? "translate-x-0" : "translate-x-full lg:hidden",
        )}
        style={
          { "--thread-diff-width": `${panelWidth}px` } as CSSProperties &
            Record<"--thread-diff-width", string>
        }
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-border to-transparent"
        />

        <button
          type="button"
          aria-label="Resize changes panel"
          className="group/resize absolute inset-y-0 left-0 z-10 hidden w-2 -translate-x-1 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none lg:flex"
          onPointerDown={startResize}
        >
          <span className="block h-10 w-px bg-border/60 transition group-hover/resize:h-16 group-hover/resize:bg-primary/60 group-focus-visible/resize:bg-primary" />
        </button>

        <header className="relative flex shrink-0 flex-col gap-2 border-b border-border/55 bg-muted/18 px-4 pb-3 pt-3.5">
          <div className="flex items-center gap-2.5">
            <span className="relative inline-flex size-7 items-center justify-center border border-border/60 bg-muted/30">
              <FileDiff className="size-3.5 text-foreground" aria-hidden="true" />
              {entries.length > 0 ? (
                <span className="absolute -right-1 -top-1 inline-flex size-3.5 items-center justify-center bg-foreground font-mono text-[8.5px] font-semibold leading-none text-background">
                  {entries.length > 99 ? "99" : entries.length}
                </span>
              ) : null}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-mono text-[10.5px] uppercase tracking-[0.22em] text-muted-foreground">
                Diff
              </h2>
              <p className="truncate text-[13px] font-semibold leading-tight tracking-tight">
                {entries.length === 0
                  ? isLoading
                    ? "Computing changes…"
                    : "No changes yet"
                  : `${entries.length} ${entries.length === 1 ? "file" : "files"} changed`}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 lg:hidden"
              onClick={() => onOpenChange(false)}
              aria-label="Close changes panel"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>

          {entries.length > 0 ? (
            <DiffStatBar
              additions={totals.additions}
              deletions={totals.deletions}
            />
          ) : null}
        </header>

        {showEmpty ? (
          <EmptyState />
        ) : showLoadingList ? (
          <LoadingList />
        ) : (
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(96px,min(190px,32%))_minmax(0,1fr)] overflow-hidden">
            <ul
              role="listbox"
              aria-label="Changed files"
              className="minimal-scrollbar relative min-h-0 overflow-y-auto border-b border-border/55 bg-muted/10 px-2 py-1.5"
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
    <div className="flex items-center gap-2">
      <div className="flex h-1 flex-1 overflow-hidden bg-border/40">
        <span
          className="block h-full bg-emerald-500/70 transition-[width] duration-500"
          style={{ width: `${addPct}%` }}
        />
        <span
          className="block h-full bg-red-500/70 transition-[width] duration-500"
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
  const total = Math.max(1, entry.additions + entry.deletions);
  const addPct = (entry.additions / total) * 100;

  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        title={entry.file}
        onClick={onSelect}
        className={cn(
          "group/row relative flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/35",
          active
            ? "bg-foreground/[0.045] dark:bg-foreground/[0.055]"
            : "hover:bg-foreground/[0.025] dark:hover:bg-foreground/[0.035]",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-1 left-0 w-px transition-colors",
            active
              ? "bg-foreground"
              : "bg-transparent group-hover/row:bg-border",
          )}
        />

        <span
          aria-hidden="true"
          className={cn(
            "flex size-4 shrink-0 items-center justify-center font-mono text-[8.5px] font-semibold leading-none",
            entry.status === "added"
              ? "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
              : entry.status === "deleted"
                ? "bg-red-500/12 text-red-700 dark:bg-red-500/20 dark:text-red-300"
                : "bg-amber-500/12 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
          )}
        >
          {statusGlyph(entry.status)}
        </span>

        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate font-mono text-[11.5px] font-medium leading-tight tracking-tight",
              active ? "text-foreground" : "text-foreground/90",
            )}
          >
            {name}
          </span>
          {dir ? (
            <span className="mt-0.5 block truncate font-mono text-[9.5px] leading-tight text-muted-foreground/70">
              {dir}
            </span>
          ) : null}
        </span>

        <span className="flex shrink-0 items-center gap-1.5">
          {showTurn ? (
            <span
              className={cn(
                "hidden border px-1.5 py-px font-mono text-[9px] uppercase leading-none tracking-[0.12em] sm:inline-flex",
                active
                  ? "border-foreground/35 text-foreground"
                  : "border-border/70 text-muted-foreground/80",
              )}
            >
              Turn {entry.turn}
            </span>
          ) : null}
          <span className="hidden h-2 w-7 overflow-hidden bg-border/40 sm:block">
            <span
              className="block h-full bg-emerald-500/80"
              style={{ width: `${addPct}%` }}
            />
            <span
              className="-mt-2.5 block h-full bg-red-500/80"
              style={{ width: `${100 - addPct}%`, marginLeft: `${addPct}%` }}
            />
          </span>
          <span className="flex flex-col items-end font-mono text-[10px] leading-tight tabular-nums">
            <span className="text-emerald-600/90 dark:text-emerald-400/90">
              +{entry.additions}
            </span>
            <span className="text-red-600/90 dark:text-red-400/90">
              −{entry.deletions}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

function DetailView({ entry, showTurn }: { entry: ThreadDiffEntry; showTurn: boolean }) {
  const { name, dir } = pathParts(entry.file);

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-border/55 bg-background/92 px-3 pb-2 pt-2 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <GitCommitVertical
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span
            className={cn(
              "shrink-0 border px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.18em]",
              entry.status === "added"
                ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                : entry.status === "deleted"
                  ? "border-red-500/30 text-red-700 dark:text-red-300"
                  : "border-amber-500/30 text-amber-700 dark:text-amber-300",
            )}
          >
            {statusLabel(entry.status)}
          </span>
          {showTurn ? (
            <span className="shrink-0 border border-border/70 px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">
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
            <p className="truncate font-mono text-[10px] leading-snug text-muted-foreground/70">
              {dir}/
            </p>
          ) : null}
          <p className="break-all font-mono text-[12px] font-semibold leading-snug tracking-tight text-foreground">
            {name}
          </p>
        </div>
      </div>

      <div className="p-2">
        <ToolDiffView key={entry.id} diff={entry.diff} pathLine={entry.file} />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="relative inline-flex size-12 items-center justify-center">
        <span
          aria-hidden="true"
          className="absolute inset-0 border border-dashed border-border/70"
        />
        <FileDiff className="size-5 text-muted-foreground/70" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          Awaiting changes
        </p>
        <p className="max-w-[220px] font-mono text-[11px] leading-relaxed text-muted-foreground/70">
          File edits from the agent will surface here as they happen.
        </p>
      </div>
    </div>
  );
}

function LoadingList() {
  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(120px,min(240px,38%))_minmax(0,1fr)] overflow-hidden">
      <div className="minimal-scrollbar min-h-0 overflow-hidden border-b border-border/60 px-2 py-2">
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
      <span className="size-5 shrink-0 animate-pulse bg-muted" />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span
          className="h-2.5 animate-pulse bg-muted"
          style={{ width: `${55 + ((delay * 7) % 30)}%` }}
        />
        <span
          className="h-2 animate-pulse bg-muted/70"
          style={{ width: `${30 + ((delay * 5) % 25)}%` }}
        />
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="h-2 w-6 animate-pulse bg-muted" />
        <span className="h-2 w-5 animate-pulse bg-muted/70" />
      </span>
    </li>
  );
}

function LoadingDiff() {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-border/60 px-3 pb-2.5 pt-2.5">
        <div className="flex items-center gap-2">
          <span className="size-3.5 animate-pulse bg-muted" />
          <span className="h-3.5 w-16 animate-pulse bg-muted" />
          <span className="ml-auto h-2.5 w-14 animate-pulse bg-muted" />
        </div>
        <div className="mt-2 space-y-1.5">
          <span className="block h-2 w-2/3 animate-pulse bg-muted/70" />
          <span className="block h-2.5 w-4/5 animate-pulse bg-muted" />
        </div>
      </div>
      <div className="space-y-1.5 px-3 py-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <span
            key={i}
            className="block h-2.5 animate-pulse bg-muted/80"
            style={{
              width: `${[92, 78, 60, 84, 45, 70, 88, 52, 66][i]}%`,
              animationDelay: `${i * 70}ms`,
            }}
          />
        ))}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 border-t border-border/60 bg-background/80 px-3 py-2 backdrop-blur"
      >
        <span className="relative inline-flex size-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping bg-foreground/40" />
          <span className="relative inline-flex size-1.5 bg-foreground" />
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Computing diff
        </span>
      </div>
    </div>
  );
}
