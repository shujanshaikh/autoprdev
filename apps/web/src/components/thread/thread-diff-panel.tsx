import { api } from "@autopr/backend/convex/_generated/api";
import { Button } from "@autopr/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@autopr/ui/components/dropdown-menu";
import { cn } from "@autopr/ui/lib/utils";
import { useAction } from "convex/react";
import { ArrowRight, ExternalLink, FileDiff, GitBranch, GitPullRequest, Loader2, Maximize2, Minimize2, Monitor, Plus, Send, Terminal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

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
};

const MIN_PANEL_WIDTH = 380;
const MAX_PANEL_WIDTH_RATIO = 0.8;
const MAX_PANEL_WIDTH = 720;
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

function getMaxPanelWidth() {
  if (typeof window === "undefined") return DEFAULT_PANEL_WIDTH;
  return Math.max(
    MIN_PANEL_WIDTH,
    Math.min(
      MAX_PANEL_WIDTH,
      Math.floor(window.innerWidth * MAX_PANEL_WIDTH_RATIO),
      window.innerWidth - DOCKED_MAIN_MIN_WIDTH,
    ),
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
}: ThreadDiffPanelProps) {
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [expandedEntryId, setExpandedEntryId] = useState<string | undefined>();
  const [visibleTabs, setVisibleTabs] = useState<ThreadDiffPanelVisibleTab[]>(DEFAULT_VISIBLE_TABS);
  const [activeTabId, setActiveTabId] = useState("");
  const [title, setTitle] = useState(threadTitle ?? "AutoPR changes");
  const [desktopUrl, setDesktopUrl] = useState<string | undefined>();
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
  const resizeCleanupRef = useRef<(() => void) | undefined>(undefined);
  const getDesktopPreview = useAction(api.projectActions.getDesktopPreview);
  const getSandboxRuntimeStatus = useAction(api.projectActions.getSandboxRuntimeStatus);

  const activeTab = visibleTabs.find((tab) => tab.id === activeTabId)?.kind ?? visibleTabs[0]?.kind;
  const terminalTabs = useMemo(() => visibleTabs.filter((tab) => tab.kind === "terminal"), [visibleTabs]);

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(visibleTabs[0]?.id ?? "");
    }
  }, [activeTabId, visibleTabs]);

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
      const startWidth = panelWidth;
      const target = event.currentTarget;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      let resizing = true;

      target.setPointerCapture(pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const nextWidth = Math.min(getMaxPanelWidth(), Math.max(MIN_PANEL_WIDTH, startWidth + startX - moveEvent.clientX));
        setPanelWidth(nextWidth);
      };

      const stopResize = () => {
        if (!resizing) return;
        resizing = false;

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
    [panelWidth],
  );

  useEffect(() => () => resizeCleanupRef.current?.(), []);

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

  useEffect(() => {
    if (activeTab !== "desktop") return;

    setHasOpenedDesktop(true);
    if (!desktopRuntimeStatus && !desktopStatusLoading) {
      void refreshDesktopStatus();
    }
  }, [activeTab, desktopRuntimeStatus, desktopStatusLoading, refreshDesktopStatus]);

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
      setDesktopUrl(data.url);
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
        id="thread-changes-panel"
        aria-hidden={!open}
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex h-full max-h-full w-[min(96vw,720px)] min-w-0 flex-col border-l border-border/50 bg-background transition-transform duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] lg:static lg:z-auto lg:w-[var(--thread-diff-width)] lg:shrink-0",
          open ? "translate-x-0" : "translate-x-full lg:hidden",
        )}
        style={{ "--thread-diff-width": `min(${panelWidth}px, ${MAX_PANEL_WIDTH}px, 80vw, calc(100vw - ${DOCKED_MAIN_MIN_WIDTH}px))` } as CSSProperties & Record<"--thread-diff-width", string>}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-px bg-gradient-to-b from-transparent via-border/60 to-transparent" />

        <button
          type="button"
          aria-label="Resize changes panel"
          className="group/resize absolute inset-y-0 left-0 z-10 hidden w-2.5 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none lg:flex"
          onPointerDown={startResize}
        >
          <span className="block h-12 w-0.5 rounded-full bg-border/50 transition-all duration-200 group-hover/resize:h-20 group-hover/resize:bg-primary/50 group-focus-visible/resize:bg-primary" />
        </button>

        <header className="relative flex shrink-0 flex-col border-b border-border/55 bg-background">
          <div className="flex h-10 items-center gap-1 border-b border-border/45 px-3">
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
                    activeTabId === visibleTab.id ? "border-border/60 bg-muted/50 text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/35 hover:text-foreground",
                  )}
                >
                  <button type="button" onClick={() => setActiveTabId(visibleTab.id)} className="inline-flex h-full items-center gap-1.5 px-2.5">
                    <Icon className="size-3.5" aria-hidden="true" />
                    {label}
                    {visibleTab.kind === "pull-request" && effectiveStatus === "created" ? (
                      <span className="ml-0.5 size-1.5 bg-primary" aria-hidden="true" />
                    ) : null}
                  </button>
                  {visibleTabs.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => removePanelTab(visibleTab.id)}
                      className="mr-1 inline-flex size-4 items-center justify-center text-muted-foreground/60 opacity-70 hover:bg-muted hover:text-foreground group-hover/tab:opacity-100"
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

            <Button type="button" variant="ghost" size="icon" className="ml-auto size-7 lg:hidden" onClick={() => onOpenChange(false)} aria-label="Close panel">
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          </div>

          {activeTab === "diff" ? (
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
                        "group flex min-h-[118px] flex-col items-start justify-between rounded-lg border border-border/55 bg-card/35 p-4 text-left",
                        "transition-[background-color,border-color,transform] duration-150 hover:border-border hover:bg-muted/35 active:translate-y-px",
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
                  className="inline-flex h-7 items-center gap-1.5 border border-border bg-muted/35 px-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:bg-muted hover:text-foreground"
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
                  className="group inline-flex h-8 items-center gap-1.5 border border-border/60 bg-background px-3 text-[12.5px] font-medium text-foreground/85 transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground disabled:cursor-wait disabled:opacity-50"
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
                  "relative flex min-h-0 flex-1 flex-col overflow-hidden bg-zinc-950",
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
            <div key={terminalTab.id} className={cn("min-h-0 flex-1 overflow-hidden bg-[#1B1B1B]", isActiveTerminal ? "flex" : "hidden")}>
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
                      <span className="inline-block size-1.5 bg-primary" aria-hidden="true" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">
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
                      <span className="inline-block size-1.5 bg-primary" aria-hidden="true" />
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
                          <dd className="tabular-nums text-emerald-600 dark:text-emerald-400">+{totals.additions}</dd>
                        </div>
                        <div className="inline-flex items-center gap-1.5">
                          <dt className="text-muted-foreground">removed</dt>
                          <dd className="tabular-nums text-red-600 dark:text-red-400">−{totals.deletions}</dd>
                        </div>
                      </dl>
                    ) : null}

                    <div className="space-y-3.5">
                      <label className="block space-y-1.5">
                        <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">branch</span>
                        <div className="flex h-9 border border-border bg-background focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/40">
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
                          className="h-9 w-full border border-border bg-background px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/45 focus:border-ring focus:ring-1 focus:ring-ring/40"
                        />
                      </label>
                      <label className="block space-y-1.5">
                        <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">description</span>
                        <textarea
                          value={body}
                          onChange={(event) => setBody(event.target.value)}
                          placeholder="Optional PR description…"
                          rows={4}
                          className="w-full resize-none border border-border bg-background px-2.5 py-2 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/45 focus:border-ring focus:ring-1 focus:ring-ring/40"
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
                            ? "border-primary/50 bg-primary/10 text-primary"
                            : "border-border bg-muted/40 text-muted-foreground/60",
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
          )
        ) : null}
      </aside>
    </>
    );
  }
