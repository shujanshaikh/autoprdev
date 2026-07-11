import { cn } from "@autopr/ui/lib/utils";
import {
  type CodeViewItem,
  type CodeViewLineSelection,
  type CodeViewOptions,
  type SelectedLineRange,
  type ThemeTypes,
} from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { Check, ChevronDown, ChevronRight, Copy, Link2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePierreDiffPreferences } from "@/components/ai-elements/pierre-diff-view";
import { pathParts } from "#/lib/file-type-icon";
import {
  createDiffPromptContext,
  createThreadDiffCodeViewItem,
  type DiffPromptContext,
  type ThreadDiffDeepLink,
  type ThreadDiffEntry,
} from "./thread-diff-panel-utils";

const CODE_VIEW_CSS = `
[data-diffs-header] {
  container-name: autopr-sticky-diff-header;
  container-type: scroll-state;
  background: var(--project-panel, var(--background));
}

@container autopr-sticky-diff-header scroll-state(stuck: top) {
  [data-diffs-header]::after {
    position: absolute;
    inset: auto 0 -1px;
    height: 1px;
    content: '';
    background: var(--project-selected-strong, var(--border));
    opacity: 0.65;
  }
}
`;

function linkForSelection(entry: ThreadDiffEntry, range?: SelectedLineRange) {
  const url = new URL(window.location.href);
  url.searchParams.set("diff", entry.id);
  url.searchParams.set("diffFile", entry.file);
  if (range) {
    url.searchParams.set("line", String(range.start));
    url.searchParams.set("lineEnd", String(range.end));
    url.searchParams.set("side", range.side ?? "additions");
    url.searchParams.set("endSide", range.endSide ?? range.side ?? "additions");
  } else {
    url.searchParams.delete("line");
    url.searchParams.delete("lineEnd");
    url.searchParams.delete("side");
    url.searchParams.delete("endSide");
  }
  return url;
}

async function copyUrl(url: URL) {
  window.history.replaceState(window.history.state, "", url);
  await navigator.clipboard.writeText(url.toString());
}

function CollapseButton({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex size-6 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-[color:var(--project-panel-soft)] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--cohere-form-focus)]"
      aria-label={collapsed ? "Expand diff" : "Collapse diff"}
    >
      {collapsed
        ? <ChevronRight className="size-4" aria-hidden="true" />
        : <ChevronDown className="size-4" aria-hidden="true" />}
    </button>
  );
}

function HeaderMetadata({
  entry,
  copied,
  viewed,
  onCopy,
  onViewedChange,
}: {
  entry: ThreadDiffEntry;
  copied: boolean;
  viewed: boolean;
  onCopy: () => void;
  onViewedChange: (viewed: boolean) => void;
}) {
  return (
    <span className="flex items-center gap-1.5 pr-1">
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex size-6 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-[color:var(--project-panel-soft)] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--cohere-form-focus)]"
        aria-label={`Copy link to ${entry.file}`}
        title="Copy link to file"
      >
        {copied ? <Check className="size-3.5 text-blue-500" aria-hidden="true" /> : <Link2 className="size-3.5" aria-hidden="true" />}
      </button>
      <button
        type="button"
        role="checkbox"
        aria-checked={viewed}
        aria-label={viewed ? `Mark ${entry.file} unviewed` : `Mark ${entry.file} viewed`}
        title={viewed ? "Mark unviewed" : "Mark viewed"}
        onClick={() => onViewedChange(!viewed)}
        className={cn(
          "inline-flex size-6 items-center justify-center rounded-[6px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cohere-form-focus)]",
          viewed
            ? "border-blue-500/70 bg-blue-500 text-white hover:bg-blue-500/85"
            : "border-border bg-background text-transparent hover:border-blue-500/60 hover:text-blue-500/35",
        )}
      >
        <Check className="size-4" strokeWidth={2.5} aria-hidden="true" />
      </button>
    </span>
  );
}

export function ThreadDiffCodeView({
  entries,
  threadId,
  viewedEntryIds,
  deepLink,
  onViewedChange,
  onAddPromptContext,
}: {
  entries: ThreadDiffEntry[];
  threadId: string;
  viewedEntryIds: Set<string>;
  deepLink?: ThreadDiffDeepLink;
  onViewedChange: (entryId: string, viewed: boolean) => void;
  onAddPromptContext?: (context: DiffPromptContext) => void;
}) {
  const { resolvedTheme } = useTheme();
  const { diffStyle, lineDiffType } = usePierreDiffPreferences();
  const viewerRef = useRef<CodeViewHandle<undefined> | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selectionClearFrameRef = useRef<number | undefined>(undefined);
  const appliedDeepLinkRef = useRef<string | undefined>(undefined);
  const [collapsedEntryIds, setCollapsedEntryIds] = useState<Set<string>>(() => new Set());
  const [selectedLines, setSelectedLines] = useState<CodeViewLineSelection | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<string | undefined>();

  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const parsedItems = useMemo(
    () => entries.map((entry) => createThreadDiffCodeViewItem(entry, threadId, false)),
    [entries, threadId],
  );
  const items = useMemo(
    () => parsedItems.map((item) => {
      const collapsed = collapsedEntryIds.has(item.id);
      return {
        ...item,
        collapsed,
        version: (item.version ?? 0) + (collapsed ? 1 : 0),
      } satisfies CodeViewItem;
    }),
    [collapsedEntryIds, parsedItems],
  );

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    if (selectionClearFrameRef.current !== undefined) cancelAnimationFrame(selectionClearFrameRef.current);
  }, []);

  const showCopied = useCallback((target: string) => {
    setCopiedTarget(target);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedTarget(undefined), 1_600);
  }, []);

  const toggleCollapsed = useCallback((entryId: string) => {
    setCollapsedEntryIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }, []);

  const copyEntryLink = useCallback(async (entry: ThreadDiffEntry, range?: SelectedLineRange) => {
    try {
      await copyUrl(linkForSelection(entry, range));
      showCopied(range ? `selection:${entry.id}` : entry.id);
    } catch {
      // Clipboard access can be denied; the address bar still contains the link.
    }
  }, [showCopied]);

  const handleSelectionEnd = useCallback((range: SelectedLineRange | null, itemId: string) => {
    const entry = entryById.get(itemId);
    if (!range || !entry) return;
    window.history.replaceState(window.history.state, "", linkForSelection(entry, range));
  }, [entryById]);

  const options = useMemo<CodeViewOptions<undefined>>(
    () => ({
      themeType: (resolvedTheme === "light" ? "light" : "dark") satisfies ThemeTypes,
      diffStyle,
      diffIndicators: "bars",
      overflow: "wrap",
      disableLineNumbers: false,
      disableBackground: false,
      lineDiffType,
      maxLineDiffLength: 1000,
      tokenizeMaxLineLength: 1000,
      expansionLineCount: 20,
      hunkSeparators: "line-info-basic",
      lineHoverHighlight: "both",
      enableLineSelection: Boolean(onAddPromptContext),
      enableGutterUtility: Boolean(onAddPromptContext),
      stickyHeaders: true,
      pointerEventsOnScroll: false,
      layout: { paddingTop: 0, paddingBottom: 8, gap: 6 },
      unsafeCSS: CODE_VIEW_CSS,
      onGutterUtilityClick(range, context) {
        const entry = entryById.get(context.item.id);
        if (entry && context.item.type === "diff") {
          onAddPromptContext?.(createDiffPromptContext(entry, range));
          if (selectionClearFrameRef.current !== undefined) {
            cancelAnimationFrame(selectionClearFrameRef.current);
          }
          selectionClearFrameRef.current = requestAnimationFrame(() => {
            selectionClearFrameRef.current = undefined;
            setSelectedLines(null);
            viewerRef.current?.clearSelectedLines();
          });
        }
      },
      onLineSelectionEnd(range, context) {
        handleSelectionEnd(range, context.item.id);
      },
    }),
    [diffStyle, entryById, handleSelectionEnd, lineDiffType, onAddPromptContext, resolvedTheme],
  );

  useEffect(() => {
    if (!deepLink) return;
    const targetEntry = entryById.get(deepLink.entryId)
      ?? entries.find((entry) => entry.file === deepLink.file);
    if (!targetEntry) return;

    const targetKey = JSON.stringify([targetEntry.id, deepLink.start, deepLink.end, deepLink.side, deepLink.endSide]);
    if (appliedDeepLinkRef.current === targetKey) return;
    if (collapsedEntryIds.has(targetEntry.id)) {
      setCollapsedEntryIds((current) => {
        const next = new Set(current);
        next.delete(targetEntry.id);
        return next;
      });
      return;
    }

    const frame = requestAnimationFrame(() => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      if (deepLink.start !== undefined) {
        const range: SelectedLineRange = {
          start: deepLink.start,
          end: deepLink.end ?? deepLink.start,
          side: deepLink.side ?? "additions",
          endSide: deepLink.endSide ?? deepLink.side ?? "additions",
        };
        setSelectedLines({ id: targetEntry.id, range });
        viewer.setSelectedLines({ id: targetEntry.id, range });
        viewer.scrollTo({ type: "range", id: targetEntry.id, range, align: "center", behavior: "smooth-auto" });
      } else {
        viewer.scrollTo({ type: "item", id: targetEntry.id, align: "start", behavior: "smooth-auto" });
      }
      appliedDeepLinkRef.current = targetKey;
    });
    return () => cancelAnimationFrame(frame);
  }, [collapsedEntryIds, deepLink, entries, entryById]);

  const renderHeaderPrefix = useCallback((item: CodeViewItem) => {
    const entry = entryById.get(item.id);
    if (!entry) return null;
    return (
      <span className="flex items-center">
        <CollapseButton collapsed={item.collapsed === true} onClick={() => toggleCollapsed(item.id)} />
      </span>
    );
  }, [entryById, toggleCollapsed]);

  const renderHeaderMetadata = useCallback((item: CodeViewItem) => {
    const entry = entryById.get(item.id);
    if (!entry) return null;
    return (
      <HeaderMetadata
        entry={entry}
        copied={copiedTarget === entry.id}
        viewed={viewedEntryIds.has(entry.id)}
        onCopy={() => void copyEntryLink(entry)}
        onViewedChange={(viewed) => onViewedChange(entry.id, viewed)}
      />
    );
  }, [copiedTarget, copyEntryLink, entryById, onViewedChange, viewedEntryIds]);

  const selectedEntry = selectedLines ? entryById.get(selectedLines.id) : undefined;
  const selectedRange = selectedLines?.range;
  const selectionLabel = selectedEntry && selectedRange
    ? `${pathParts(selectedEntry.file).name}:${selectedRange.start}${selectedRange.end !== selectedRange.start ? `–${selectedRange.end}` : ""}`
    : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {selectedEntry && selectedRange ? (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-[color:var(--project-panel-soft)] px-3">
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
            Selected <span className="font-medium text-foreground">{selectionLabel}</span>
          </span>
          <button
            type="button"
            onClick={() => void copyEntryLink(selectedEntry, selectedRange)}
            className="inline-flex h-6 items-center gap-1.5 rounded-[4px] px-2 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--cohere-form-focus)]"
          >
            {copiedTarget === `selection:${selectedEntry.id}`
              ? <Check className="size-3.5 text-blue-500" aria-hidden="true" />
              : <Copy className="size-3.5" aria-hidden="true" />}
            {copiedTarget === `selection:${selectedEntry.id}` ? "Copied" : "Copy link"}
          </button>
        </div>
      ) : null}
      <CodeView
        ref={viewerRef}
        className="thread-diff-code-view diff-panel-view minimal-scrollbar min-h-0 flex-1 overflow-auto overscroll-contain bg-background [contain:strict] [overflow-anchor:none] [will-change:scroll-position]"
        items={items}
        options={options}
        selectedLines={selectedLines}
        onSelectedLinesChange={setSelectedLines}
        renderHeaderPrefix={renderHeaderPrefix}
        renderHeaderMetadata={renderHeaderMetadata}
      />
    </div>
  );
}
