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

function statusColor(kind: ThreadGitStatus["kind"]) {
  if (kind === "synchronized") return "bg-emerald-500";
  if (kind === "behind") return "bg-sky-500";
  if (kind === "diverged" || kind === "detached" || kind === "remote_unavailable") return "bg-destructive";
  if (kind === "not_repository" || kind === "no_remote") return "bg-muted-foreground";
  return "bg-amber-500";
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
        {query.isFetching ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <GitBranch className="size-3" aria-hidden />}
        <span>{query.error?.message ?? "Reading Git status…"}</span>
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
      <span className={cn("size-1.5 shrink-0 rounded-full", statusColor(status.kind))} aria-hidden />
      <span className="truncate text-foreground/85">{branch}</span>
      {status.aheadCount !== null && status.aheadCount > 0 ? <span className="text-amber-600">↑{status.aheadCount}</span> : null}
      {status.behindCount !== null && status.behindCount > 0 ? <span className="text-sky-600">↓{status.behindCount}</span> : null}
      {status.hasWorkingTreeChanges ? (
        <span className="text-amber-600">●{status.changedFiles.length}{status.changedFilesTruncated ? "+" : ""}</span>
      ) : null}
      {status.pullRequest ? <span className="whitespace-nowrap text-violet-600">PR #{status.pullRequest.number}</span> : null}
      <span className="hidden whitespace-nowrap text-muted-foreground xl:inline">{kindLabels[status.kind]}</span>
      {query.isFetching ? (
        <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      )}
    </button>
  );
}
