import { Skeleton } from "@autopr/ui/components/skeleton";
import { cn } from "@autopr/ui/lib/utils";
import { ExternalLink, GitBranch, GitPullRequest, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import {
  type ProjectPullRequest,
  useProjectPullRequests,
} from "#/lib/project-pull-requests";

type PullFilter = "all" | "open" | "closed";

const PULL_REQUEST_SKELETON_KEYS = ["first", "second", "third", "fourth", "fifth", "sixth"];
const EMPTY_PULL_REQUESTS: ProjectPullRequest[] = [];

function pullState(pull: ProjectPullRequest) {
  return pull.draft ? "draft" : pull.state;
}

function relativeUpdate(dateValue: string) {
  const elapsed = Date.now() - new Date(dateValue).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return new Date(dateValue).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
}

function PullRequestListSkeleton() {
  return (
    <div className="divide-y divide-border border-y border-border">
      {PULL_REQUEST_SKELETON_KEYS.map((key) => (
        <div key={key} className="flex items-start gap-3 px-4 py-3.5">
          <Skeleton className="mt-0.5 size-4 shrink-0 rounded-xs" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-4/5 rounded-xs" />
            <Skeleton className="h-2.5 w-3/5 rounded-xs" />
          </div>
          <Skeleton className="h-3 w-8 rounded-xs" />
        </div>
      ))}
    </div>
  );
}

export function ThreadPullRequestList({
  projectId,
  currentPullRequestNumber,
}: {
  projectId: string;
  currentPullRequestNumber?: number;
}) {
  const [filter, setFilter] = useState<PullFilter>("all");
  const { data, error, isLoading, isFetching, refetch } = useProjectPullRequests(projectId);
  const pulls = data?.pulls ?? EMPTY_PULL_REQUESTS;
  const visiblePulls = useMemo(
    () => pulls.filter((pull) => filter === "all" || pull.state === filter),
    [filter, pulls],
  );
  const counts = useMemo(() => ({
    all: pulls.length,
    open: pulls.filter((pull) => pull.state === "open").length,
    closed: pulls.filter((pull) => pull.state === "closed").length,
  }), [pulls]);

  return (
    <div className="minimal-scrollbar min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="sticky top-0 z-[2] border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="inline-flex size-7 shrink-0 items-center justify-center border border-border bg-[color:var(--project-panel-soft)]">
            <GitPullRequest className="size-3.5 text-foreground/80" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-medium text-foreground">Repository pull requests</h2>
            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
              {data?.project.repoFullName ?? "Loading repository…"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="inline-flex size-7 shrink-0 items-center justify-center border border-border text-muted-foreground transition-colors hover:bg-[color:var(--project-panel-soft)] hover:text-foreground disabled:cursor-wait disabled:opacity-60"
            aria-label="Refresh pull requests"
            title="Refresh pull requests"
          >
            <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} aria-hidden="true" />
          </button>
        </div>

        {!isLoading && !error ? (
          <div className="flex items-center gap-1 px-4 pb-3" role="group" aria-label="Filter pull requests">
            {(["all", "open", "closed"] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={filter === item}
                onClick={() => setFilter(item)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 border px-2.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
                  filter === item
                    ? "border-[color:var(--project-selected-strong)] bg-[color:var(--project-selected)] text-[color:var(--project-selected-strong)]"
                    : "border-border text-muted-foreground hover:bg-[color:var(--project-panel-soft)] hover:text-foreground",
                )}
              >
                {item}
                <span className="tabular-nums opacity-70">{counts[item]}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <PullRequestListSkeleton />
      ) : error ? (
        <div className="m-4 border border-destructive/35 bg-destructive/[0.04] p-4" role="alert">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-destructive">GitHub unavailable</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {error instanceof Error ? error.message : "Could not load pull requests."}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 inline-flex h-7 items-center gap-1.5 border border-border px-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground hover:bg-[color:var(--project-panel-soft)]"
          >
            <RefreshCw className="size-3" aria-hidden="true" />
            Try again
          </button>
        </div>
      ) : pulls.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
          <GitPullRequest className="size-5 text-muted-foreground/45" aria-hidden="true" />
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-foreground">No pull requests yet</p>
          <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
            This GitHub repository has no open or closed pull requests.
          </p>
        </div>
      ) : visiblePulls.length === 0 ? (
        <div className="flex min-h-48 items-center justify-center px-6 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          No {filter} pull requests
        </div>
      ) : (
        <div className="divide-y divide-border">
          {visiblePulls.map((pull) => {
            const state = pullState(pull);
            const current = pull.number === currentPullRequestNumber;

            return (
              <a
                key={pull.id}
                href={pull.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "group relative flex items-start gap-3 px-4 py-3.5 transition-colors",
                  "hover:bg-[color:var(--project-panel-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[color:var(--cohere-form-focus)]",
                  current && "bg-[color:color-mix(in_srgb,var(--project-selected)_65%,transparent)]",
                )}
                aria-label={`Open pull request #${pull.number} on GitHub`}
              >
                <span
                  className={cn(
                    "mt-1 inline-block size-2 shrink-0 rounded-full",
                    state === "open" && "bg-[color:var(--cohere-deep-green)]",
                    state === "draft" && "border border-muted-foreground bg-transparent",
                    state === "closed" && "bg-muted-foreground/45",
                  )}
                  aria-hidden="true"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-start gap-2">
                    <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-foreground">
                      {pull.title}
                    </p>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">#{pull.number}</span>
                  </div>

                  <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-muted-foreground">
                    <span className="uppercase tracking-[0.14em]">{state}</span>
                    {current ? (
                      <span className="border border-[color:var(--project-selected-strong)] px-1.5 py-0.5 uppercase tracking-[0.12em] text-[color:var(--project-selected-strong)]">
                        this thread
                      </span>
                    ) : null}
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <GitBranch className="size-3 shrink-0" aria-hidden="true" />
                      <span className="max-w-40 truncate text-foreground/75">{pull.headRef}</span>
                      <span aria-hidden="true">→</span>
                      <span className="max-w-28 truncate">{pull.baseRef}</span>
                    </span>
                    <span>by {pull.user}</span>
                    <span className="ml-auto shrink-0">{relativeUpdate(pull.updatedAt)}</span>
                  </div>
                </div>

                <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/45 transition-colors group-hover:text-foreground" aria-hidden="true" />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
