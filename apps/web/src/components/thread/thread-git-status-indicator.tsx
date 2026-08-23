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
  enabled: boolean;
}

const kindLabels = {
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
} satisfies Record<ThreadGitStatus["kind"], string>;

/**
 * A healthy repository stays quiet — only deviations earn a colour, and the
 * colours come from the Framer palette rather than raw Tailwind hues.
 */
type StatusTone = "quiet" | "info" | "attention" | "danger";

const kindTones = {
  not_repository: "quiet",
  synchronized: "quiet",
  no_remote: "quiet",
  uncommitted: "attention",
  ahead: "attention",
  no_upstream: "attention",
  behind: "info",
  diverged: "danger",
  detached: "danger",
  remote_unavailable: "danger",
} satisfies Record<ThreadGitStatus["kind"], StatusTone>;

const toneText = {
  quiet: "text-muted-foreground",
  info: "text-[color:var(--framer-accent-blue)]",
  attention: "text-[color:var(--framer-gradient-orange)]",
  danger: "text-[color:var(--framer-gradient-coral)]",
} satisfies Record<StatusTone, string>;

const shellClassName =
  "hidden h-7 min-w-0 max-w-full items-center gap-2 rounded-[var(--radius-pill)] border border-transparent pl-2 pr-2 font-mono text-[11px] lg:inline-flex";

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

function Divider() {
  return <span className="h-3 w-px shrink-0 bg-[color:var(--project-line)]" aria-hidden />;
}

export function ThreadGitStatusIndicator({
  projectId,
  threadId,
  persistedStatus,
  invalidatedAt,
  enabled,
}: ThreadGitStatusIndicatorProps) {
  const query = useThreadGitStatusQuery({
    projectId,
    threadId,
    persistedStatus,
    enabled,
    refetchInterval: false,
  });
  const status = query.data ?? persistedStatus;

  useEffect(() => {
    if (enabled && invalidatedAt && invalidatedAt > (status?.checkedAt ?? 0)) {
      void query.refetch();
    }
  }, [enabled, invalidatedAt, query.refetch, status?.checkedAt]);

  if (!status) {
    return (
      <div className={cn(shellClassName, "ml-2 text-muted-foreground")}>
        {query.isFetching ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden /> : <GitBranch className="size-3.5 shrink-0 opacity-70" aria-hidden />}
        <span className="truncate">{query.error?.message ?? "Reading Git status…"}</span>
      </div>
    );
  }

  const description = statusDescription(status);
  const tone = kindTones[status.kind];
  const branch = status.detachedHead
    ? `detached@${status.localHeadSha?.slice(0, 7) ?? "HEAD"}`
    : status.currentBranch ?? "unknown branch";
  const aheadCount = status.aheadCount ?? 0;
  const behindCount = status.behindCount ?? 0;
  const hasCounts = aheadCount > 0 || behindCount > 0 || status.hasWorkingTreeChanges;

  return (
    <button
      type="button"
      onClick={() => void query.refetch()}
      disabled={query.isFetching}
      className={cn(
        shellClassName,
        "group ml-2 text-muted-foreground transition-colors duration-200 ease-out",
        "hover:border-[color:var(--project-line)] hover:bg-[color:var(--project-panel-soft)] hover:text-foreground",
        "focus-visible:outline-none focus-visible:border-[color:var(--project-line)] focus-visible:bg-[color:var(--project-panel-soft)] focus-visible:ring-[1.5px] focus-visible:ring-[color:var(--cohere-form-focus)]",
        "disabled:cursor-wait",
      )}
      aria-label={`${description}. Refresh Git status.`}
      title={description}
    >
      <GitBranch
        className={cn("size-3.5 shrink-0 transition-colors", toneText[tone])}
        aria-hidden
      />
      <span className="min-w-0 truncate font-medium text-foreground/85">{branch}</span>

      {hasCounts ? (
        <>
          <Divider />
          <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
            {aheadCount > 0 ? (
              <span className="text-[color:var(--framer-accent-blue)]">↑{aheadCount}</span>
            ) : null}
            {behindCount > 0 ? (
              <span className="text-[color:var(--framer-accent-blue)]">↓{behindCount}</span>
            ) : null}
            {status.hasWorkingTreeChanges ? (
              <span className="text-[color:var(--framer-gradient-orange)]">
                ~{status.changedFiles.length}{status.changedFilesTruncated ? "+" : ""}
              </span>
            ) : null}
          </span>
        </>
      ) : null}

      {status.pullRequest ? (
        <>
          <Divider />
          <span className="shrink-0 whitespace-nowrap tabular-nums text-[color:var(--framer-accent-blue)]">
            PR #{status.pullRequest.number}
          </span>
        </>
      ) : null}

      <span className="hidden shrink-0 items-center gap-2 xl:flex">
        <Divider />
        <span className={cn("whitespace-nowrap", toneText[tone])}>{kindLabels[status.kind]}</span>
      </span>

      <span className="ml-0.5 flex size-3.5 shrink-0 items-center justify-center" aria-hidden>
        {query.isFetching ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5 opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-70 group-focus-visible:opacity-70" />
        )}
      </span>
    </button>
  );
}
