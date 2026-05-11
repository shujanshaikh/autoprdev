"use client";

import { Button } from "@autopr/ui/components/button";
import { cn } from "@autopr/ui/lib/utils";
import { ArrowRight, ExternalLink, FileDiff, GitBranch, GitPullRequest, Loader2, Send, X } from "lucide-react";
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
const MAX_PANEL_WIDTH = 860;
const DEFAULT_PANEL_WIDTH = 640;

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
  const [activeTab, setActiveTab] = useState<"diff" | "pull-request">("diff");
  const [title, setTitle] = useState(threadTitle ?? "AutoPR changes");
  const [branchName, setBranchName] = useState("");
  const [body, setBody] = useState("");
  const [localStatus, setLocalStatus] = useState<typeof pullRequestStatus>();
  const [localError, setLocalError] = useState<string | undefined>();
  const [createdPull, setCreatedPull] = useState<{ url: string; number?: number; branch?: string } | undefined>();
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
  const effectiveStatus = localStatus ?? pullRequestStatus ?? "idle";
  const effectiveUrl = createdPull?.url ?? pullRequestUrl;
  const effectiveNumber = createdPull?.number ?? pullRequestNumber;
  const effectiveBranch = createdPull?.branch ?? pullRequestBranch;
  const effectiveError = localError ?? pullRequestError;
  const creating = effectiveStatus === "creating";
  const requestedBranch = autoprBranchName(branchName);
  const canCreatePullRequest = entries.length > 0 && !creating && effectiveStatus !== "created" && title.trim().length > 0 && requestedBranch.length > 0;

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
            <button
              type="button"
              onClick={() => setActiveTab("diff")}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 border px-2.5 text-xs font-medium transition-colors",
                activeTab === "diff" ? "border-border/60 bg-muted/50 text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/35 hover:text-foreground",
              )}
            >
              <GitBranch className="size-3.5" aria-hidden="true" />
              Diff
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("pull-request")}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 border px-2.5 text-xs font-medium transition-colors",
                activeTab === "pull-request" ? "border-border/60 bg-muted/50 text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/35 hover:text-foreground",
              )}
            >
              <GitPullRequest className="size-3.5" aria-hidden="true" />
              Pull request
              {effectiveStatus === "created" ? (
                <span className="ml-0.5 size-1.5 bg-primary" aria-hidden="true" />
              ) : null}
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

                  <div className="space-y-4 px-4 py-4">
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

                  <div className="space-y-5 px-4 py-4">
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
        ) : showEmpty ? (
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
