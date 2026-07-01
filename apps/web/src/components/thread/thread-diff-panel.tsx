import { api } from "@autopr/backend/convex/_generated/api";
import { ButtonGroup } from "@autopr/ui/components/button-group";
import { Button } from "@autopr/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@autopr/ui/components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@autopr/ui/components/tooltip";
import { cn } from "@autopr/ui/lib/utils";
import { useAction } from "convex/react";
import { ArrowRight, Columns2, ExternalLink, FileDiff, GitBranch, GitPullRequest, List, Loader2, Maximize2, Minimize2, Monitor, Plus, Send, Terminal, TextSearch, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import { usePierreDiffPreferences, type PierreDiffStyle } from "@/components/ai-elements/pierre-diff-view";
import { DaytonaDesktopView } from "./daytona-desktop-view";
import { DaytonaTerminalView } from "./daytona-terminal-view";
import { ThreadDiffDetailView } from "./thread-diff-panel-detail-view";
import { ThreadDiffEmptyState, ThreadDiffLoadingList } from "./thread-diff-panel-states";
import { ThreadDiffFileRow } from "./thread-diff-panel-file-row";
import type { ThreadDiffEntry } from "./thread-diff-panel-utils";

export type ThreadDiffPanelProps = {
  entries: ThreadDiffEntry[];
  selectedEntryId?: string;
  onSelectEntry: (id: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading?: boolean;
  projectId: string;
  threadId: string;
  threadTitle?: string;
  baseBranch?: string;
  pullRequestStatus?: "idle" | "creating" | "created" | "failed";
  pullRequestUrl?: string;
  pullRequestNumber?: number;
  pullRequestBranch?: string;
  pullRequestError?: string;
  maximized?: boolean;
  onMaximizedChange?: (maximized: boolean) => void;
};

const MIN_PANEL_WIDTH = 380;
const DOCKED_MAIN_MIN_WIDTH = 420;
const DEFAULT_PANEL_WIDTH = 640;

type ThreadDiffPanelTabKind = "diff" | "pull-request" | "desktop" | "terminal";

type ThreadDiffPanelVisibleTab = {
  id: string;
  kind: ThreadDiffPanelTabKind;
};

const THREAD_DIFF_PANEL_TABS: Array<{
  kind: ThreadDiffPanelTabKind;
  label: string;
  menuLabel: string;
  icon: typeof GitBranch;
}> = [
  { kind: "diff", label: "Diffs", menuLabel: "Diffs", icon: GitBranch },
  { kind: "pull-request", label: "Pull request", menuLabel: "PR", icon: GitPullRequest },
  { kind: "desktop", label: "Desktop", menuLabel: "Desktop", icon: Monitor },
  { kind: "terminal", label: "Terminal", menuLabel: "New terminal", icon: Terminal },
];

const SINGLETON_TAB_IDS: Record<Exclude<ThreadDiffPanelTabKind, "terminal">, string> = {
  diff: "diff",
  "pull-request": "pull-request",
  desktop: "desktop",
};

const DEFAULT_VISIBLE_TABS: ThreadDiffPanelVisibleTab[] = [];

function createTerminalTab(): ThreadDiffPanelVisibleTab {
  return { id: `terminal:${Date.now()}:${Math.random().toString(36).slice(2)}`, kind: "terminal" };
}

const SURFACE_PICKER_ITEMS: Array<{
  kind: ThreadDiffPanelTabKind;
  title: string;
  description: string;
  icon: typeof GitBranch;
}> = [
  { kind: "diff", title: "Diff", description: "Review changes in this thread.", icon: FileDiff },
  { kind: "desktop", title: "Desktop", description: "Open the workspace desktop.", icon: Monitor },
  { kind: "terminal", title: "Terminal", description: "Start a shell in this workspace.", icon: Terminal },
  { kind: "pull-request", title: "Pull request", description: "Create or open a PR for these changes.", icon: GitPullRequest },
];

const DIFF_LAYOUT_OPTIONS: Array<{
  value: PierreDiffStyle;
  label: string;
  icon: typeof FileDiff;
}> = [
  { value: "unified", label: "Normal", icon: List },
  { value: "split", label: "Split", icon: Columns2 },
];

function getMaxPanelWidth(panelElement?: HTMLElement | null) {
  if (typeof window === "undefined") return DEFAULT_PANEL_WIDTH;
  const containerWidth = panelElement?.parentElement?.getBoundingClientRect().width ?? window.innerWidth;

  return Math.max(
    MIN_PANEL_WIDTH,
    Math.floor(containerWidth - DOCKED_MAIN_MIN_WIDTH),
  );
}

function autoprBranchName(value: string) {
  const withoutPrefix = value.trim().replace(/^autopr[/-]*/i, "");
  const slug = withoutPrefix
    .replace(/\\/g, "/")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._/-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/\/+/g, "/")
    .replace(/^[/.-]+|[/.-]+$/g, "")
    .replace(/\.lock$/i, "-lock")
    .slice(0, 96);

  return slug ? `autopr/${slug}` : "";
}

export function ThreadDiffPanel({
  entries,
  selectedEntryId,
  onSelectEntry,
  open,
  onOpenChange,
  isLoading = false,
  projectId,
  threadId,
  threadTitle,
  baseBranch,
  pullRequestStatus,
  pullRequestUrl,
  pullRequestNumber,
  pullRequestBranch,
  pullRequestError,
  maximized = false,
  onMaximizedChange,
}: ThreadDiffPanelProps) {
  const [panelWidth, setPanelWidth] = useState(() => getMaxPanelWidth());
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const [expandedEntryId, setExpandedEntryId] = useState<string | undefined>();
  const [visibleTabs, setVisibleTabs] = useState<ThreadDiffPanelVisibleTab[]>(DEFAULT_VISIBLE_TABS);
  const [activeTabId, setActiveTabId] = useState("");
  const [title, setTitle] = useState(threadTitle ?? "AutoPR changes");
  const [desktopWebsocketUrl, setDesktopWebsocketUrl] = useState<string | undefined>();
  const [desktopLoading, setDesktopLoading] = useState(false);
  const [desktopStatusLoading, setDesktopStatusLoading] = useState(false);
  const [desktopRuntimeStatus, setDesktopRuntimeStatus] = useState<"started" | "stopped" | "archived" | "unknown" | undefined>();
  const [, setDesktopRawState] = useState<string | undefined>();
  const [desktopError, setDesktopError] = useState<string | undefined>();
  const [desktopFullscreen, setDesktopFullscreen] = useState(false);
  const [hasOpenedDesktop, setHasOpenedDesktop] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [body, setBody] = useState("");
  const [localStatus, setLocalStatus] = useState<typeof pullRequestStatus>();
  const [localError, setLocalError] = useState<string | undefined>();
  const [createdPull, setCreatedPull] = useState<{ url: string; number?: number; branch?: string } | undefined>();
  const { diffStyle, similarChanges, setDiffStyle, setSimilarChanges } = usePierreDiffPreferences();
  const panelRef = useRef<HTMLElement | null>(null);
  const panelWidthRef = useRef(panelWidth);
  const resizeCleanupRef = useRef<(() => void) | undefined>(undefined);
  const panelResizeObserverRef = useRef<ResizeObserver | undefined>(undefined);
  const getDesktopPreview = useAction(api.projectActions.getDesktopPreview);
  const getSandboxRuntimeStatus = useAction(api.projectActions.getSandboxRuntimeStatus);

  const activeTab = visibleTabs.find((tab) => tab.id === activeTabId)?.kind ?? visibleTabs[0]?.kind;
  const terminalTabs = useMemo(() => visibleTabs.filter((tab) => tab.kind === "terminal"), [visibleTabs]);

  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(visibleTabs[0]?.id ?? "");
    }
  }, [activeTabId, visibleTabs]);

  const setPanelElement = useCallback((panel: HTMLElement | null) => {
    panelResizeObserverRef.current?.disconnect();
    panelResizeObserverRef.current = undefined;
    panelRef.current = panel;

    const container = panel?.parentElement;
    if (!panel || !container || typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(() => {
      setPanelWidth((currentWidth) => {
        const nextWidth = Math.min(currentWidth, getMaxPanelWidth(panel));
        panelWidthRef.current = nextWidth;
        panel.style.setProperty("--thread-diff-width", `min(${nextWidth}px, calc(100% - ${DOCKED_MAIN_MIN_WIDTH}px))`);
        return nextWidth;
      });
    });

    resizeObserver.observe(container);
    panelResizeObserverRef.current = resizeObserver;
  }, []);

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
      resizeCleanupRef.current?.();

      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = panelWidthRef.current;
      const target = event.currentTarget;
      const panel = panelRef.current;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      let resizing = true;
      let nextWidth = startWidth;
      let animationFrame: number | undefined;

      target.setPointerCapture(pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      setIsResizingPanel(true);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        nextWidth = Math.min(getMaxPanelWidth(panel), Math.max(MIN_PANEL_WIDTH, startWidth + startX - moveEvent.clientX));

        if (animationFrame !== undefined) return;
        animationFrame = window.requestAnimationFrame(() => {
          animationFrame = undefined;
          panelWidthRef.current = nextWidth;
          panel?.style.setProperty("--thread-diff-width", `min(${nextWidth}px, calc(100% - ${DOCKED_MAIN_MIN_WIDTH}px))`);
        });
      };

      const stopResize = () => {
        if (!resizing) return;
        resizing = false;

        if (animationFrame !== undefined) {
          window.cancelAnimationFrame(animationFrame);
          animationFrame = undefined;
        }
        panelWidthRef.current = nextWidth;
        panel?.style.setProperty("--thread-diff-width", `min(${nextWidth}px, calc(100% - ${DOCKED_MAIN_MIN_WIDTH}px))`);
        setPanelWidth(nextWidth);
        setIsResizingPanel(false);

        if (target.hasPointerCapture(pointerId)) {
          target.releasePointerCapture(pointerId);
        }
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
        resizeCleanupRef.current = undefined;
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize);
      window.addEventListener("pointercancel", stopResize);
      resizeCleanupRef.current = stopResize;
    },
    [],
  );

  useEffect(
    () => () => {
      resizeCleanupRef.current?.();
      panelResizeObserverRef.current?.disconnect();
    },
    [],
  );

  const showLoadingList = isLoading && entries.length === 0;
  const showEmpty = !isLoading && entries.length === 0;
  const effectiveStatus = localStatus ?? pullRequestStatus ?? "idle";
  const effectiveUrl = createdPull?.url ?? pullRequestUrl;
  const effectiveNumber = createdPull?.number ?? pullRequestNumber;
  const effectiveBranch = createdPull?.branch ?? pullRequestBranch;
  const effectiveError = localError ?? pullRequestError;
  const creating = effectiveStatus === "creating";
  const requestedBranch = autoprBranchName(branchName);
  const canCreatePullRequest = entries.length > 0 && !creating && effectiveStatus !== "created" && title.trim().length > 0 && requestedBranch.length > 0;
  const panelMaximized = open && maximized;

  const refreshDesktopStatus = useCallback(async () => {
    setDesktopStatusLoading(true);
    setDesktopError(undefined);

    try {
      const status = await getSandboxRuntimeStatus({ projectId });
      setDesktopRuntimeStatus(status.status);
      setDesktopRawState(status.rawState);
    } catch (error) {
      setDesktopRuntimeStatus("unknown");
      setDesktopError(error instanceof Error ? error.message : "Could not read the VM state.");
    } finally {
      setDesktopStatusLoading(false);
    }
  }, [getSandboxRuntimeStatus, projectId]);

  const openPanelTab = useCallback(
    (kind: ThreadDiffPanelTabKind) => {
      if (kind === "terminal") {
        const terminalTab = createTerminalTab();
        setVisibleTabs((current) => [...current, terminalTab]);
        setActiveTabId(terminalTab.id);
        return;
      }

      const tabId = SINGLETON_TAB_IDS[kind];
      setVisibleTabs((current) => (current.some((tab) => tab.id === tabId) ? current : [...current, { id: tabId, kind }]));
      setActiveTabId(tabId);

      if (kind === "desktop") {
        setHasOpenedDesktop(true);
        if (!desktopRuntimeStatus && !desktopStatusLoading) {
          void refreshDesktopStatus();
        }
      }
    },
    [desktopRuntimeStatus, desktopStatusLoading, refreshDesktopStatus],
  );

  const selectPanelTab = useCallback(
    (tab: ThreadDiffPanelVisibleTab) => {
      setActiveTabId(tab.id);

      if (tab.kind === "desktop") {
        setHasOpenedDesktop(true);
        if (!desktopRuntimeStatus && !desktopStatusLoading) {
          void refreshDesktopStatus();
        }
      }
    },
    [desktopRuntimeStatus, desktopStatusLoading, refreshDesktopStatus],
  );

  const removePanelTab = useCallback(
    (tabId: string) => {
      setVisibleTabs((current) => {
        const removedIndex = current.findIndex((tab) => tab.id === tabId);
        const next = current.filter((tab) => tab.id !== tabId);
        if (activeTabId === tabId) {
          setActiveTabId(next[Math.max(0, removedIndex - 1)]?.id ?? next[0]?.id ?? "");
        }
        return next;
      });
    },
    [activeTabId],
  );

  const loadDesktop = useCallback(async () => {
    setDesktopLoading(true);
    setDesktopError(undefined);

    try {
      const data = await getDesktopPreview({ projectId });
      setDesktopWebsocketUrl(data.websocketUrl);
      setDesktopRuntimeStatus("started");
      setDesktopRawState("started");
    } catch (error) {
      setDesktopError(error instanceof Error ? error.message : "Could not start the Daytona desktop.");
      void refreshDesktopStatus();
    } finally {
      setDesktopLoading(false);
    }
  }, [getDesktopPreview, projectId, refreshDesktopStatus]);

  const createPullRequest = useCallback(async () => {
    if (!canCreatePullRequest) return;

    setLocalStatus("creating");
    setLocalError(undefined);

    try {
      const response = await fetch(
        `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}/pull-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title.trim() || undefined, body: body.trim() || undefined, branch: requestedBranch }),
        },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Could not create pull request.");
      }

      setCreatedPull({ url: data.url, number: data.number, branch: data.branch });
      setLocalStatus("created");
    } catch (error) {
      setLocalStatus("failed");
      setLocalError(error instanceof Error ? error.message : "Could not create pull request.");
    }
  }, [body, canCreatePullRequest, projectId, requestedBranch, threadId, title]);

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
        ref={setPanelElement}
        id="thread-changes-panel"
        aria-hidden={!open}
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex h-full max-h-full min-w-0 flex-col overflow-hidden border-l border-border bg-background transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none lg:static lg:z-auto lg:shrink-0 lg:will-change-[width]",
          isResizingPanel && "transition-none",
          panelMaximized
            ? "inset-x-0 w-full lg:w-full"
            : "w-[min(96vw,720px)] lg:w-[var(--thread-diff-width)] lg:shrink-0",
          open ? "translate-x-0" : "translate-x-full lg:hidden",
        )}
        style={{ "--thread-diff-width": `min(${panelWidth}px, calc(100% - ${DOCKED_MAIN_MIN_WIDTH}px))` } as CSSProperties & Record<"--thread-diff-width", string>}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-px bg-border" />

        <button
          type="button"
          aria-label="Resize changes panel"
          className={cn(
            "group/resize absolute inset-y-0 left-0 z-10 hidden w-2.5 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none lg:flex",
            panelMaximized && "lg:hidden",
          )}
          onPointerDown={startResize}
        >
          <span className="block h-12 w-0.5 rounded-full bg-border transition-all duration-200 group-hover/resize:h-20 group-hover/resize:bg-[color:var(--project-selected-strong)] group-focus-visible/resize:bg-[color:var(--project-selected-strong)]" />
        </button>

        <header className="relative flex shrink-0 flex-col border-b border-border bg-background">
          <div className="flex h-10 items-center gap-1 border-b border-border px-3">
            {visibleTabs.map((visibleTab, index) => {
              const tab = THREAD_DIFF_PANEL_TABS.find((candidate) => candidate.kind === visibleTab.kind);
              if (!tab) return null;

              const Icon = tab.icon;
              const terminalNumber = visibleTab.kind === "terminal" ? visibleTabs.slice(0, index + 1).filter((candidate) => candidate.kind === "terminal").length : undefined;
              const label = terminalNumber ? `Terminal ${terminalNumber}` : tab.label;

              return (
                <div
                  key={visibleTab.id}
                  className={cn(
                    "group/tab inline-flex h-7 items-center border text-xs font-medium transition-colors",
                    activeTabId === visibleTab.id ? "border-border bg-[color:var(--project-panel-soft)] text-foreground" : "border-transparent text-muted-foreground hover:bg-[color:var(--project-panel-soft)] hover:text-foreground",
                  )}
                >
                  <button type="button" onClick={() => selectPanelTab(visibleTab)} className="inline-flex h-full items-center gap-1.5 px-2.5">
                    <Icon className="size-3.5" aria-hidden="true" />
                    {label}
                    {visibleTab.kind === "pull-request" && effectiveStatus === "created" ? (
                      <span className="ml-0.5 size-1.5 bg-[color:var(--project-selected-strong)]" aria-hidden="true" />
                    ) : null}
                  </button>
                  {visibleTabs.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => removePanelTab(visibleTab.id)}
                      className="mr-1 inline-flex size-4 items-center justify-center text-muted-foreground/60 opacity-70 hover:bg-[color:var(--project-panel-soft)] hover:text-foreground group-hover/tab:opacity-100"
                      aria-label={`Remove ${label} tab`}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              );
            })}

            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Add tab" />}>
                <Plus className="size-3.5" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                {THREAD_DIFF_PANEL_TABS.map((tab) => {
                  const Icon = tab.icon;
                  const installed = tab.kind !== "terminal" && visibleTabs.some((visibleTab) => visibleTab.kind === tab.kind);
                  return (
                    <DropdownMenuItem key={tab.kind} onClick={() => openPanelTab(tab.kind)}>
                      <Icon className="size-3.5" aria-hidden="true" />
                      <span className="flex-1">{tab.menuLabel}</span>
                      {installed ? <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">added</span> : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="ml-auto flex shrink-0 items-center gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={cn("size-7", panelMaximized && "bg-[color:var(--project-panel-soft)] text-foreground")}
                      onClick={() => onMaximizedChange?.(!panelMaximized)}
                      aria-pressed={panelMaximized}
                      aria-label={panelMaximized ? "Restore surface panel size" : "Maximize surface panel"}
                    >
                      {panelMaximized ? (
                        <Minimize2 className="size-3.5" aria-hidden="true" />
                      ) : (
                        <Maximize2 className="size-3.5" aria-hidden="true" />
                      )}
                    </Button>
                  }
                />
                <TooltipContent side="bottom" sideOffset={8}>
                  {panelMaximized ? "Restore Surface" : "Maximize Surface"}
                </TooltipContent>
              </Tooltip>

              <Button type="button" variant="ghost" size="icon" className="size-7 lg:hidden" onClick={() => onOpenChange(false)} aria-label="Close panel">
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>

          {activeTab === "diff" ? (
            <div className="flex min-h-10 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="inline-flex size-6 items-center justify-center border border-border bg-[color:var(--project-panel-soft)]">
                  <FileDiff className="size-3.5 text-foreground/80" aria-hidden="true" />
                </span>
                <p className="truncate text-sm font-medium text-foreground">Thread changes</p>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{totals.files} files</span>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {entries.length > 0 ? (
                  <div className="hidden shrink-0 items-center gap-2 font-mono text-xs tabular-nums min-[460px]:flex">
                    <span className="text-[color:var(--cohere-deep-green)] dark:text-[color:var(--cohere-pale-green)]">+{totals.additions}</span>
                    <span className="text-[color:var(--cohere-coral)]">−{totals.deletions}</span>
                  </div>
                ) : null}

                <ButtonGroup aria-label="Diff layout" className="h-7">
                  {DIFF_LAYOUT_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    const selected = diffStyle === option.value;

                    return (
                      <Button
                        key={option.value}
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-pressed={selected}
                        aria-label={`${option.label} diff`}
                        title={`${option.label} diff`}
                        onClick={() => setDiffStyle(option.value)}
                        className={cn(
                          "h-7 border-border/60 px-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground",
                          "hover:bg-[color:var(--project-panel-soft)] hover:text-foreground",
                          selected && "bg-[color:var(--project-panel-soft)] text-foreground hover:bg-[color:var(--project-panel-soft)]",
                        )}
                      >
                        <Icon className="size-3.5" aria-hidden="true" />
                        <span className="hidden min-[560px]:inline">{option.label}</span>
                      </Button>
                    );
                  })}
                </ButtonGroup>

                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-pressed={similarChanges}
                        aria-label={similarChanges ? "Hide similar inline changes" : "Show similar inline changes"}
                        onClick={() => setSimilarChanges(!similarChanges)}
                        className={cn(
                          "h-7 border border-border/60 px-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground",
                          "hover:bg-[color:var(--project-panel-soft)] hover:text-foreground",
                          similarChanges && "bg-[color:var(--project-panel-soft)] text-foreground hover:bg-[color:var(--project-panel-soft)]",
                        )}
                      >
                        <TextSearch className="size-3.5" aria-hidden="true" />
                        <span className="hidden min-[620px]:inline">Similar</span>
                      </Button>
                    }
                  />
                  <TooltipContent side="bottom" sideOffset={8}>
                    {similarChanges ? "Hide Similar Changes" : "Show Similar Changes"}
                  </TooltipContent>
                </Tooltip>

                <Button type="button" variant="ghost" size="icon" className="size-7 lg:hidden" onClick={() => onOpenChange(false)} aria-label="Close changes panel">
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : null}


        </header>

        {!activeTab ? (
          <div className="minimal-scrollbar flex min-h-0 flex-1 overflow-auto bg-background">
            <div className="mx-auto flex w-full max-w-[540px] flex-col justify-center px-6 py-10">
              <div className="mb-7 text-center">
                <h2 className="text-xl font-medium tracking-normal text-foreground">Open a surface</h2>
                <p className="mt-2 text-sm text-muted-foreground">Choose what to show in the right panel.</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {SURFACE_PICKER_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.kind}
                      type="button"
                      onClick={() => openPanelTab(item.kind)}
                      className={cn(
                        "group flex min-h-[118px] flex-col items-start justify-between rounded-sm border border-border bg-card p-4 text-left",
                        "transition-[background-color,border-color,transform] duration-150 hover:border-[color:var(--project-selected-strong)] hover:bg-[color:var(--project-panel-soft)] active:translate-y-px",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45",
                      )}
                    >
                      <Icon className="size-6 text-foreground/80 transition-colors group-hover:text-foreground/90" aria-hidden="true" />
                      <span className="space-y-1">
                        <span className="block text-lg font-medium text-foreground">{item.title}</span>
                        <span className="block text-[13px] leading-relaxed text-muted-foreground">{item.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        <div className={cn("min-h-0 flex-1 flex-col bg-background", activeTab === "desktop" ? "flex" : "hidden")}>
          {hasOpenedDesktop ? (
          <>
            {desktopWebsocketUrl ? (
              <div className="flex h-10 shrink-0 items-center justify-end gap-2 border-b border-border/45 px-3">
                <button
                  type="button"
                  onClick={() => setDesktopFullscreen((value) => !value)}
                  className="inline-flex h-7 items-center gap-1.5 border border-border bg-[color:var(--project-panel-soft)] px-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
                >
                  {desktopFullscreen ? <Minimize2 className="size-3" aria-hidden="true" /> : <Maximize2 className="size-3" aria-hidden="true" />}
                  {desktopFullscreen ? "exit" : "fullscreen"}
                </button>
              </div>
            ) : null}

            {desktopError ? (
              <div
                className="mx-4 mt-4 border border-destructive/40 bg-destructive/[0.04] px-3 py-2 font-mono text-xs text-destructive/90"
                role="alert"
              >
                {desktopError}
              </div>
            ) : null}

            {!desktopWebsocketUrl ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8">
                <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground/55">
                  {desktopStatusLoading
                    ? "Checking sandbox"
                    : desktopRuntimeStatus === "stopped"
                      ? "Sandbox · Stopped"
                      : desktopRuntimeStatus === "started"
                        ? "Sandbox · Awake"
                        : desktopRuntimeStatus === "archived"
                          ? "Sandbox · Archived"
                        : "Sandbox · Unknown"}
                </p>
                <button
                  type="button"
                  onClick={() => void loadDesktop()}
                  disabled={desktopLoading || desktopStatusLoading}
                  className="group inline-flex h-8 items-center gap-1.5 border border-border bg-background px-3 text-[12.5px] font-medium text-foreground/85 transition-colors hover:border-[color:var(--project-selected-strong)] hover:bg-[color:var(--project-panel-soft)] hover:text-foreground disabled:cursor-wait disabled:opacity-50"
                >
                  {desktopLoading ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : null}
                  <span>{desktopRuntimeStatus === "started" ? "Open Desktop" : "Awake the VM"}</span>
                </button>
              </div>
            ) : (
              <div
                className={cn(
                  "relative flex min-h-0 flex-1 flex-col overflow-hidden bg-black",
                  desktopFullscreen && "fixed inset-0 z-[100]",
                )}
              >
                {desktopFullscreen ? (
                  <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 bg-black/85 px-3">
                    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/65">
                      <Monitor className="size-3.5" aria-hidden="true" />
                      desktop preview
                    </div>
                    <button
                      type="button"
                      onClick={() => setDesktopFullscreen(false)}
                      className="inline-flex h-7 items-center gap-1.5 border border-white/15 bg-white/5 px-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/75 hover:bg-white/10 hover:text-white"
                    >
                      <Minimize2 className="size-3" aria-hidden="true" />
                      exit fullscreen
                    </button>
                  </div>
                ) : null}
                <div className="relative min-h-0 flex-1">
                  <DaytonaDesktopView
                    websocketUrl={desktopWebsocketUrl}
                    loading={desktopLoading}
                    className="absolute inset-0"
                  />
                </div>
              </div>
            )}
          </>
          ) : null}
        </div>

        {terminalTabs.map((terminalTab) => {
          const isActiveTerminal = activeTabId === terminalTab.id;

          return (
            <div key={terminalTab.id} className={cn("min-h-0 flex-1 overflow-hidden bg-[color:var(--cohere-primary)]", isActiveTerminal ? "flex" : "hidden")}>
              {isActiveTerminal ? <DaytonaTerminalView projectId={projectId} /> : null}
            </div>
          );
        })}

        {activeTab === "pull-request" ? (
          <div className="minimal-scrollbar min-h-0 flex-1 overflow-auto bg-background">
            <div className="mx-auto flex w-full max-w-[520px] flex-col gap-5 px-5 py-6">
              {effectiveStatus === "created" && effectiveUrl ? (
                <div className="border border-border bg-card">
                  <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-block size-1.5 bg-[color:var(--project-selected-strong)]" aria-hidden="true" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--project-selected-strong)]">
                        pull request · created
                      </span>
                    </div>
                    {effectiveNumber ? (
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                        #{effectiveNumber}
                      </span>
                    ) : null}
                  </div>

                  <div className="space-y-4 p-4">
                    <dl className="space-y-2.5 font-mono text-xs">
                      <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-border/60 pb-1.5">
                        <dt className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">title</dt>
                        <dd className="truncate text-right text-foreground">{title.trim() || "AutoPR changes"}</dd>
                      </div>
                      {effectiveBranch ? (
                        <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-border/60 pb-1.5">
                          <dt className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">branch</dt>
                          <dd className="truncate text-right text-foreground">{effectiveBranch}</dd>
                        </div>
                      ) : null}
                      <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-border/60 pb-1.5">
                        <dt className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">base</dt>
                        <dd className="truncate text-right text-foreground">{baseBranch ?? "main"}</dd>
                      </div>
                    </dl>

                    {effectiveBranch ? (
                      <div className="flex items-center gap-2 font-mono text-[11px]">
                        <span className="inline-flex flex-1 items-center gap-1.5 truncate border border-border bg-muted/30 px-2.5 py-1.5 text-foreground/85">
                          <GitBranch className="size-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                          <span className="truncate">{effectiveBranch}</span>
                        </span>
                        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/55" aria-hidden="true" />
                        <span className="inline-flex flex-1 items-center gap-1.5 truncate border border-border bg-muted/30 px-2.5 py-1.5 text-foreground/85">
                          <GitBranch className="size-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                          <span className="truncate">{baseBranch ?? "main"}</span>
                        </span>
                      </div>
                    ) : null}

                    <a
                      href={effectiveUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 w-full items-center justify-center gap-2 border border-primary bg-primary px-3 font-mono text-[11px] uppercase tracking-[0.22em] text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    >
                      open on github
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    </a>
                  </div>
                </div>
              ) : (
                <div className="border border-border bg-card">
                  <div className="flex items-center justify-between gap-4 border-b border-border bg-muted/30 px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-block size-1.5 bg-[color:var(--project-selected-strong)]" aria-hidden="true" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-foreground">
                        create pull request
                      </span>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
                      {entries.length > 0 ? `${String(totals.files).padStart(2, "0")} files` : "empty"}
                    </span>
                  </div>

                  <div className="space-y-5 p-4">
                    <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                      Push all changes in this thread sandbox to GitHub and open a PR against{" "}
                      <span className="font-mono text-foreground/85">{baseBranch ?? "the base branch"}</span>.
                    </p>

                    <div className="flex items-center gap-2 font-mono text-[11px]">
                      <span className="inline-flex flex-1 items-center gap-1.5 truncate border border-border bg-muted/30 px-2.5 py-1.5 text-foreground/80">
                        <GitBranch className="size-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                        <span className="truncate">{requestedBranch || "autopr/your-branch"}</span>
                      </span>
                      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/55" aria-hidden="true" />
                      <span className="inline-flex flex-1 items-center gap-1.5 truncate border border-border bg-muted/30 px-2.5 py-1.5 text-foreground/85">
                        <GitBranch className="size-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                        <span className="truncate">{baseBranch ?? "main"}</span>
                      </span>
                    </div>

                    {entries.length > 0 ? (
                      <dl className="flex items-center gap-6 border-y border-border py-2.5 font-mono text-[10px] uppercase tracking-[0.22em]">
                        <div className="inline-flex items-center gap-1.5">
                          <dt className="text-muted-foreground">files</dt>
                          <dd className="tabular-nums text-foreground">{String(totals.files).padStart(2, "0")}</dd>
                        </div>
                        <div className="inline-flex items-center gap-1.5">
                          <dt className="text-muted-foreground">added</dt>
                          <dd className="tabular-nums text-[color:var(--cohere-deep-green)] dark:text-[color:var(--cohere-pale-green)]">+{totals.additions}</dd>
                        </div>
                        <div className="inline-flex items-center gap-1.5">
                          <dt className="text-muted-foreground">removed</dt>
                          <dd className="tabular-nums text-[color:var(--cohere-coral)]">−{totals.deletions}</dd>
                        </div>
                      </dl>
                    ) : null}

                    <div className="space-y-3.5">
                      <label className="block space-y-1.5">
                        <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">branch</span>
                        <div className="flex h-9 border border-border bg-background focus-within:border-[color:var(--cohere-form-focus)] focus-within:ring-1 focus-within:ring-[color:var(--cohere-form-focus)]">
                          <span className="inline-flex items-center border-r border-border bg-muted/35 px-2.5 font-mono text-[12px] text-muted-foreground">
                            autopr/
                          </span>
                          <input
                            value={branchName}
                            onChange={(event) => setBranchName(event.target.value)}
                            placeholder="my-feature-branch"
                            className="min-w-0 flex-1 bg-transparent px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/45"
                          />
                        </div>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground/75">
                          {requestedBranch || "Branch will be created as autopr/<name>."}
                        </span>
                      </label>
                      <label className="block space-y-1.5">
                        <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">title</span>
                        <input
                          value={title}
                          onChange={(event) => setTitle(event.target.value)}
                          placeholder="AutoPR changes"
                          className="h-9 w-full border border-border bg-background px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/45 focus:border-[color:var(--cohere-form-focus)] focus:ring-1 focus:ring-[color:var(--cohere-form-focus)]"
                        />
                      </label>
                      <label className="block space-y-1.5">
                        <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">description</span>
                        <textarea
                          value={body}
                          onChange={(event) => setBody(event.target.value)}
                          placeholder="Optional PR description…"
                          rows={4}
                          className="w-full resize-none border border-border bg-background px-2.5 py-2 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/45 focus:border-[color:var(--cohere-form-focus)] focus:ring-1 focus:ring-[color:var(--cohere-form-focus)]"
                        />
                      </label>
                    </div>

                    {effectiveError ? (
                      <div role="alert" className="border border-destructive/40 bg-destructive/[0.06] px-4 py-3 font-mono text-xs">
                        <span className="mr-2 uppercase tracking-[0.2em] text-destructive">err</span>
                        <span className="text-destructive/90">{effectiveError}</span>
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => void createPullRequest()}
                      disabled={!canCreatePullRequest}
                      className={cn(
                        "inline-flex h-10 w-full items-center justify-center gap-2 border px-4 font-mono text-[11px] uppercase leading-none tracking-[0.22em]",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                        "disabled:cursor-not-allowed",
                        canCreatePullRequest
                          ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                          : creating
                            ? "border-[color:var(--project-selected-strong)] bg-[color:var(--project-selected)] text-[color:var(--project-selected-strong)]"
                            : "border-border bg-[color:var(--project-panel-soft)] text-muted-foreground/60",
                      )}
                    >
                      {creating ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          creating pull request…
                        </>
                      ) : entries.length === 0 ? (
                        <span>no changes to push</span>
                      ) : requestedBranch.length === 0 ? (
                        <span>add a branch to continue</span>
                      ) : title.trim().length === 0 ? (
                        <span>add a title to continue</span>
                      ) : (
                        <>
                          <Send className="size-3.5" aria-hidden="true" />
                          submit pull request
                          <ArrowRight className="size-3.5" aria-hidden="true" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === "diff" ? (
          showEmpty ? (
          <ThreadDiffEmptyState />
        ) : showLoadingList ? (
          <ThreadDiffLoadingList />
        ) : (
          <div className="minimal-scrollbar min-h-0 flex-1 overflow-auto bg-background p-2">
            <div aria-label="Changed files" className="flex min-h-0 flex-col gap-1.5">
              {entries.map((entry) => {
                const expanded = expandedEntryId === entry.id;
                const active = selectedEntryId === entry.id || expanded;
                return (
                  <div key={entry.id} className="overflow-hidden rounded-sm border border-border bg-card">
                    <ThreadDiffFileRow
                      entry={entry}
                      active={active}
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
          )
        ) : null}
      </aside>
    </>
    );
  }
