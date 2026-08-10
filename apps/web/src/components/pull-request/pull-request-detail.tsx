import { Button } from "@autopr/ui/components/button";
import { Skeleton } from "@autopr/ui/components/skeleton";
import { cn } from "@autopr/ui/lib/utils";
import {
  ArrowLeft,
  ArrowUpRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  MessageSquare,
  RefreshCw,
  Users,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { MessageResponse } from "#/components/ai-elements/message";
import {
  type ProjectPullRequestActor,
  type ProjectPullRequestDetail,
  type ProjectPullRequestTimelineItem,
  useProjectPullRequest,
  useProjectPullRequestTimeline,
} from "#/lib/project-pull-requests";

const PullRequestCodeTab = lazy(() => import("./pull-request-code-tab").then((module) => ({ default: module.PullRequestCodeTab })));

type DetailTab = "summary" | "timeline" | "code";

const TABS: Array<{ value: DetailTab; label: string }> = [
  { value: "summary", label: "Summary" },
  { value: "timeline", label: "Timeline" },
  { value: "code", label: "Code" },
];

function fullDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Actor({ actor }: { actor: ProjectPullRequestActor }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={actor.login}>
      {actor.avatarUrl ? (
        <img src={actor.avatarUrl} alt="" className="size-4 shrink-0 rounded-full bg-muted object-cover" />
      ) : (
        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[8px] text-muted-foreground" aria-hidden="true">
          {actor.login.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="truncate">{actor.login}</span>
    </span>
  );
}

function statePresentation(detail: ProjectPullRequestDetail) {
  if (detail.mergedAt) {
    return { label: "Merged", Icon: GitMerge, className: "text-violet-600 dark:text-violet-300" };
  }
  if (detail.state === "closed") {
    return { label: "Closed", Icon: GitPullRequestClosed, className: "text-[color:var(--cohere-coral)]" };
  }
  if (detail.draft) {
    return { label: "Draft", Icon: Clock3, className: "text-muted-foreground" };
  }
  return { label: "Open", Icon: GitPullRequest, className: "text-[color:var(--cohere-deep-green)] dark:text-[color:var(--cohere-pale-green)]" };
}

function DetailGhost() {
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border p-5">
        <Skeleton className="h-3 w-32 rounded-xs" />
        <Skeleton className="h-6 w-4/5 rounded-xs" />
        <Skeleton className="h-3 w-2/5 rounded-xs" />
      </div>
      <div className="grid grid-cols-3 gap-3 p-5">
        {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-16 rounded-xs" />)}
      </div>
      <div className="space-y-3 px-5">
        <Skeleton className="h-3 w-24 rounded-xs" />
        <Skeleton className="h-3 w-full rounded-xs" />
        <Skeleton className="h-3 w-11/12 rounded-xs" />
      </div>
    </div>
  );
}

function QueryFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="m-5 border border-destructive/30 bg-destructive/[0.04] p-4" role="alert">
      <div className="flex items-center gap-2 text-sm font-medium text-destructive">
        <CircleAlert className="size-4" aria-hidden="true" />
        Could not load this pull request
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{message}</p>
      <Button type="button" variant="outline" size="sm" className="mt-3 h-7" onClick={onRetry}>
        <RefreshCw className="size-3.5" aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="border-r border-border/60 px-4 py-3 last:border-r-0">
      <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 font-mono text-sm tabular-nums text-foreground", tone)}>{value.toLocaleString()}</dd>
    </div>
  );
}

function SummaryTab({ detail }: { detail: ProjectPullRequestDetail }) {
  const comments = detail.comments + detail.reviewComments;
  const hasConflicts = detail.mergeable === false || detail.mergeableState === "dirty";

  return (
    <div className="minimal-scrollbar h-full overflow-y-auto">
      <dl className="grid grid-cols-3 border-b border-border/60 bg-[color:color-mix(in_srgb,var(--project-panel-soft)_42%,transparent)]">
        <Metric label="Files" value={detail.changedFiles} />
        <Metric label="Added" value={detail.additions} tone="text-[color:var(--cohere-deep-green)] dark:text-[color:var(--cohere-pale-green)]" />
        <Metric label="Removed" value={detail.deletions} tone="text-[color:var(--cohere-coral)]" />
      </dl>

      <section className="grid gap-3 border-b border-border/60 px-5 py-4 text-xs sm:grid-cols-2">
        <div className="flex items-start gap-2">
          <Users className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Reviewers</p>
            <div className="mt-1.5 flex min-w-0 flex-wrap gap-2 text-foreground">
              {detail.requestedReviewers.length > 0
                ? detail.requestedReviewers.map((reviewer) => <Actor key={reviewer.login} actor={reviewer} />)
                : <span className="text-muted-foreground">None requested</span>}
            </div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Conversation</p>
            <p className="mt-1.5 text-foreground">{comments} {comments === 1 ? "comment" : "comments"}</p>
          </div>
        </div>
      </section>

      {hasConflicts ? (
        <div className="mx-5 mt-4 flex items-start gap-2 border border-destructive/25 bg-destructive/[0.04] px-3 py-2.5 text-xs text-destructive">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          This branch conflicts with {detail.baseRef} and must be updated before it can merge.
        </div>
      ) : null}

      <section className="px-5 py-5">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-medium text-foreground">Description</h2>
          {detail.labels.map((label) => (
            <span key={label.name} className="rounded-full border border-border px-2 py-0.5 font-mono text-[9px] text-muted-foreground">
              {label.name}
            </span>
          ))}
        </div>
        {detail.body.trim() ? (
          <MessageResponse className="sd-render-soft !text-[13px] !leading-6 [&_p]:!text-[13px]">{detail.body}</MessageResponse>
        ) : (
          <p className="text-sm italic text-muted-foreground">No description provided.</p>
        )}
      </section>
    </div>
  );
}

function timelineLabel(item: ProjectPullRequestTimelineItem) {
  if (item.kind === "commit") return "committed";
  if (item.kind === "comment") return "commented";
  if (item.state === "approved") return "approved these changes";
  if (item.state === "changes_requested") return "requested changes";
  return "reviewed";
}

function TimelineTab({ projectId, number }: { projectId: string; number: number }) {
  const query = useProjectPullRequestTimeline(projectId, number);
  if (query.isPending) return <DetailGhost />;
  if (query.error) return <QueryFailure message={query.error.message} onRetry={() => void query.refetch()} />;
  const items = query.data?.timeline ?? [];

  if (items.length === 0) {
    return <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">No activity has been reported yet.</div>;
  }

  return (
    <div className="minimal-scrollbar h-full overflow-y-auto px-5 py-5">
      <ol className="relative ml-2 border-l border-border">
        {items.map((item) => (
          <li key={item.id} className="relative pb-6 pl-6 last:pb-0">
            <span className="absolute -left-2 top-0 inline-flex size-4 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
              {item.kind === "commit" ? <GitCommitHorizontal className="size-2.5" aria-hidden="true" /> : <MessageSquare className="size-2.5" aria-hidden="true" />}
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
              <Actor actor={item.actor} />
              <span className="text-muted-foreground">{timelineLabel(item)}</span>
              <time className="ml-auto font-mono text-[10px] text-muted-foreground" dateTime={item.createdAt}>{fullDate(item.createdAt)}</time>
            </div>
            {item.kind === "commit" ? (
              <a href={item.url} target="_blank" rel="noreferrer" className="mt-2 block border border-border bg-card px-3 py-2.5 hover:bg-[color:var(--project-panel-soft)]">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{item.title}</span>
                  <code className="font-mono text-[10px] text-muted-foreground">{item.sha.slice(0, 7)}</code>
                </span>
                {item.message ? <span className="mt-1 block whitespace-pre-wrap text-xs text-muted-foreground">{item.message}</span> : null}
              </a>
            ) : item.body.trim() ? (
              <div className="mt-2 border border-border bg-card px-3 py-2.5">
                <MessageResponse className="sd-render-soft !text-[13px] !leading-6 [&_p]:!text-[13px]">{item.body}</MessageResponse>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PullRequestDetail({
  projectId,
  number,
  onBack,
  onOpenInAutoPR,
}: {
  projectId: string;
  number: number;
  onBack?: () => void;
  onOpenInAutoPR: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>("summary");
  const query = useProjectPullRequest(projectId, number);
  const detail = query.data?.pullRequest;

  if (query.isPending) return <DetailGhost />;
  if (query.error || !detail) return <QueryFailure message={query.error?.message ?? "The pull request was unavailable."} onRetry={() => void query.refetch()} />;

  const state = statePresentation(detail);
  const StateIcon = state.Icon;

  return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <header className="shrink-0 border-b border-border bg-background">
          <div className="flex min-h-11 items-center gap-2 border-b border-border/60 px-3 py-2">
            {onBack ? <button type="button" onClick={onBack} aria-label="Back to pull requests" className="inline-flex size-7 items-center justify-center text-muted-foreground hover:bg-[color:var(--project-panel-soft)] hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" /></button> : null}
            <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", state.className)}>
              <StateIcon className="size-3.5" aria-hidden="true" />
              {state.label}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">#{detail.number}</span>
            <span className="ml-auto min-w-0 truncate font-mono text-[10px] text-muted-foreground">updated {fullDate(detail.updatedAt)}</span>
            <a href={detail.htmlUrl} target="_blank" rel="noreferrer" aria-label="Open on GitHub" className="inline-flex size-7 shrink-0 items-center justify-center text-muted-foreground hover:bg-[color:var(--project-panel-soft)] hover:text-foreground"><ExternalLink className="size-3.5" aria-hidden="true" /></a>
          </div>

          <div className="px-5 py-4">
            <h1 className="text-lg font-semibold leading-snug tracking-[-0.015em] text-foreground">{detail.title}</h1>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <Actor actor={detail.author} />
              <span aria-hidden="true">·</span>
              <span>opened {fullDate(detail.createdAt)}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex min-w-0 items-center gap-1 font-mono text-[10px]"><GitBranch className="size-3" aria-hidden="true" /><span className="max-w-48 truncate text-foreground/80">{detail.headRef}</span><span>→</span><span className="max-w-36 truncate">{detail.baseRef}</span></span>
            </div>
          </div>

          <div className="flex items-end gap-1 px-3">
            <nav className="flex min-w-0 flex-1 items-end" aria-label="Pull request views">
              {TABS.map((item) => (
                <button key={item.value} type="button" aria-current={tab === item.value ? "page" : undefined} onClick={() => setTab(item.value)} className={cn("relative h-9 px-3 text-xs font-medium text-muted-foreground hover:text-foreground", tab === item.value && "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-[color:var(--project-selected-strong)]")}>
                  {item.label}
                  {item.value === "code" ? <span className="ml-1.5 font-mono text-[9px] text-muted-foreground">{detail.changedFiles}</span> : null}
                </button>
              ))}
            </nav>
            <Button type="button" size="sm" className="mb-1.5 h-7 shrink-0 rounded-sm px-2.5 text-[11px]" onClick={onOpenInAutoPR}>
              Open in AutoPR
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1">
          {tab === "summary" ? <SummaryTab detail={detail} /> : null}
          {tab === "timeline" ? <TimelineTab projectId={projectId} number={number} /> : null}
          {tab === "code" ? <Suspense fallback={<DetailGhost />}><PullRequestCodeTab projectId={projectId} number={number} /></Suspense> : null}
        </div>
      </div>
  );
}
