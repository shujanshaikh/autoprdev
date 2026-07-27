import type { ThreadGitStatus } from "@autopr/backend/convex/lib/gitStatus";
import { cn } from "@autopr/ui/lib/utils";
import { GitBranch, Loader2, RefreshCw } from "lucide-react";
import { useEffect } from "react";

import { useThreadGitStatusQuery } from "#/lib/thread-git-status-query";

interface ThreadGitStatusIndicatorProps {
  projectId: string;
  threadId: string;
  persistedStatus?: ThreadGitStatus;
  invalidatedAt?: number;
  isLive: boolean;
}

const kindLabels: Record<ThreadGitStatus["kind"], string> = {
  not_repository: "Not a Git repository",
  synchronized: "Clean and synchronized",
  uncommitted: "Uncommitted changes",
  ahead: "Ahead of upstream",
  behind: "Behind upstream",
  diverged: "Diverged from upstream",
  detached: "Detached HEAD",
  no_upstream: "No upstream",
  no_remote: "No remote",
  remote_unavailable: "Remote unavailable",
};

function statusTextColor(kind: ThreadGitStatus["kind"]): string {
  if (kind === "synchronized") return "text-emerald-600 dark:text-emerald-400";
  if (kind === "behind") return "text-sky-600 dark:text-sky-400";
  if (kind === "diverged" || kind === "detached" || kind === "remote_unavailable") return "text-destructive";
  if (kind === "not_repository" || kind === "no_remote") return "text-muted-foreground";
  return "text-amber-600 dark:text-amber-400";
}

function statusDescription(status: ThreadGitStatus) {
  const pieces = [kindLabels[status.kind]];
  if (status.hasWorkingTreeChanges) {
    pieces.push(`${status.changedFiles.length}${status.changedFilesTruncated ? "+" : ""} changed ${status.changedFiles.length === 1 ? "file" : "files"}`);
  }
  if (status.aheadCount !== null) pieces.push(`${status.aheadCount} ahead`);
  if (status.behindCount !== null) pieces.push(`${status.behindCount} behind`);
  if (status.remoteError?.message) pieces.push(status.remoteError.message);
  return pieces.join(" · ");
}

export function ThreadGitStatusIndicator({
  projectId,
  threadId,
  persistedStatus,
  invalidatedAt,
  isLive,
}: ThreadGitStatusIndicatorProps) {
  const query = useThreadGitStatusQuery({
    projectId,
    threadId,
    persistedStatus,
    refetchInterval: isLive ? 5_000 : 30_000,
  });
  const status = query.data ?? persistedStatus;

  useEffect(() => {
    if (invalidatedAt && invalidatedAt > (status?.checkedAt ?? 0)) {
      void query.refetch();
    }
  }, [invalidatedAt, query.refetch, status?.checkedAt]);

  if (!status) {
    return (
      <div className="hidden min-w-0 items-center gap-1.5 px-3 font-mono text-[10px] text-muted-foreground lg:flex">
        {query.isFetching ? <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden /> : <GitBranch className="size-3 shrink-0" aria-hidden />}
        <span className="truncate">{query.error?.message ?? "Reading Git status…"}</span>
      </div>
    );
  }

  const description = statusDescription(status);
  const branch = status.detachedHead
    ? `detached@${status.localHeadSha?.slice(0, 7) ?? "HEAD"}`
    : status.currentBranch ?? "unknown branch";

  return (
    <button
      type="button"
      onClick={() => void query.refetch()}
      disabled={query.isFetching}
      className="group hidden min-w-0 items-center gap-1.5 px-3 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-wait lg:flex"
      aria-label={`${description}. Refresh Git status.`}
      title={description}
    >
      <GitBranch className="size-3 shrink-0 text-muted-foreground/70" aria-hidden />
      <span className="truncate text-foreground/85">{branch}</span>
      {status.aheadCount !== null && status.aheadCount > 0 ? (
        <span className="shrink-0 tabular-nums text-amber-600 dark:text-amber-400">↑{status.aheadCount}</span>
      ) : null}
      {status.behindCount !== null && status.behindCount > 0 ? (
        <span className="shrink-0 tabular-nums text-sky-600 dark:text-sky-400">↓{status.behindCount}</span>
      ) : null}
      {status.hasWorkingTreeChanges ? (
        <span className="shrink-0 tabular-nums text-amber-600 dark:text-amber-400">
          ~{status.changedFiles.length}{status.changedFilesTruncated ? "+" : ""}
        </span>
      ) : null}
      {status.pullRequest ? (
        <span className="shrink-0 whitespace-nowrap text-violet-600 dark:text-violet-400">PR #{status.pullRequest.number}</span>
      ) : null}
      <span className={cn("hidden shrink-0 whitespace-nowrap xl:inline", statusTextColor(status.kind))}>
        {kindLabels[status.kind]}
      </span>
      {query.isFetching ? (
        <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      )}
    </button>
  );
}
