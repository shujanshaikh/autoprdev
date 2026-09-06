import { Button } from "@autopr/ui/components/button";
import { Skeleton } from "@autopr/ui/components/skeleton";
import { cn } from "@autopr/ui/lib/utils";
import {
  ArrowLeft,
  ArrowUpRight,
  CircleAlert,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  MessageSquare,
  RefreshCw,
  Check,
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

import { latestReviewerDecisions, pullRequestState, reviewDecisionLabel } from "#/lib/pull-request-review";
import { PullRequestChecks } from "./pull-request-checks";
import { PullRequestStatus } from "./pull-request-status";

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

function DetailGhost() {
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border p-5">
        <Skeleton className="animate-none h-3 w-32 rounded-xs" />
        <Skeleton className="animate-none h-6 w-4/5 rounded-xs" />
        <Skeleton className="animate-none h-3 w-2/5 rounded-xs" />
      </div>
      <div className="grid grid-cols-3 gap-3 p-5">
        {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="animate-none h-16 rounded-xs" />)}
      </div>
      <div className="space-y-3 px-5">
        <Skeleton className="animate-none h-3 w-24 rounded-xs" />
        <Skeleton className="animate-none h-3 w-full rounded-xs" />
        <Skeleton className="animate-none h-3 w-11/12 rounded-xs" />
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

function Reviewers({ detail, projectId, onTimeline }: {
  detail: ProjectPullRequestDetail;
  projectId: string;
  onTimeline: () => void;
}) {
  const activity = useProjectPullRequestTimeline(projectId, detail.number);
  const decisions = latestReviewerDecisions(activity.data?.timeline ?? []);
  const requested = new Set(detail.requestedReviewers.map((actor) => actor.login.toLowerCase()));
  const reviewedLogins = new Set(decisions.map((review) => review.actor.login.toLowerCase()));
  return (
      <section className="border-b border-border/60 px-4 py-3 text-xs" aria-label="Reviewers">
        <div className="mb-2 flex items-center gap-2"><Users className="size-3.5 text-muted-foreground" aria-hidden="true" /><h2 className="font-medium text-white">Reviews</h2><button type="button" onClick={onTimeline} className="ml-auto text-muted-foreground hover:text-white">View activity →</button></div>
        {activity.isPending ? <p role="status" className="text-muted-foreground">Loading reviews…</p> : activity.error ? <p className="text-muted-foreground" role="alert">Review history unavailable. <button type="button" onClick={() => void activity.refetch()} className="text-white underline underline-offset-4">Retry</button></p> : decisions.length === 0 && requested.size === 0 ? <p className="text-muted-foreground">No reviews yet.</p> : null}
        <div className="divide-y divide-border/40">
          {decisions.map((review) => (
            <div key={review.actor.login} className="flex flex-wrap items-center gap-2 py-2">
              <Actor actor={review.actor} />
              <a href={review.url} target="_blank" rel="noreferrer" className={cn("ml-auto inline-flex items-center gap-1.5 hover:underline", review.state === "approved" ? "text-emerald-400" : review.state === "changes_requested" ? "text-amber-400" : "text-muted-foreground")}>
                {review.state === "approved" ? <Check className="size-3" aria-hidden="true" /> : null}
                {reviewDecisionLabel(review.state)}
              </a>
              {requested.has(review.actor.login.toLowerCase()) ? <span className="text-muted-foreground">Review requested again</span> : null}
            </div>
          ))}
          {detail.requestedReviewers.map((actor) => reviewedLogins.has(actor.login.toLowerCase()) ? null : (
            <div key={actor.login} className="flex items-center gap-2 py-2"><Actor actor={actor} /><span className="ml-auto text-muted-foreground">Awaiting review</span></div>
          ))}
        </div>
      </section>
  );
}

function SummaryTab({ detail, projectId, onTimeline, onCode }: {
  detail: ProjectPullRequestDetail;
  projectId: string;
  onTimeline: () => void;
  onCode: () => void;
}) {
  const comments = detail.comments + detail.reviewComments;
  const hasConflicts = detail.mergeable === false || detail.mergeableState === "dirty";

  return (
    <div className="minimal-scrollbar h-full overflow-y-auto">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/60 px-4 py-3 text-xs">
        <button type="button" onClick={onCode} className="flex items-center gap-2 text-white hover:underline">
          <span>{detail.changedFiles} files changed</span>
          <span className="font-mono text-emerald-400">+{detail.additions.toLocaleString()}</span>
          <span className="font-mono text-red-400">−{detail.deletions.toLocaleString()}</span>
        </button>
        <button type="button" onClick={onTimeline} className="ml-auto inline-flex items-center gap-1.5 text-muted-foreground hover:text-white"><MessageSquare className="size-3.5" aria-hidden="true" />{comments} {comments === 1 ? "comment" : "comments"}</button>
      </div>

      <Reviewers detail={detail} projectId={projectId} onTimeline={onTimeline} />

      <PullRequestChecks projectId={projectId} number={detail.number} headSha={detail.headSha} htmlUrl={detail.htmlUrl} />

      {detail.state === "open" ? (
        <div className={cn("flex items-center gap-2 border-b border-border/60 px-4 py-3 text-xs", hasConflicts ? "text-red-400" : "text-muted-foreground")}>
          {hasConflicts ? <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" /> : <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />}
          {hasConflicts ? `Conflicts with ${detail.baseRef}` : detail.mergeable === true ? `No conflicts with ${detail.baseRef}` : "GitHub is checking for merge conflicts"}
        </div>
      ) : null}

      <section className="px-4 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-xs font-medium text-white">Description</h2>
          {detail.labels.map((label) => <span key={label.name} className="border-l border-border pl-2 text-[10px] text-muted-foreground">{label.name}</span>)}
        </div>
        {detail.body.trim() ? <MessageResponse className="sd-render-soft !text-[13px] !leading-6 [&_p]:!text-[13px]">{detail.body}</MessageResponse> : <p className="text-xs text-muted-foreground">No description provided.</p>}
      </section>
    </div>
  );
}

function timelineLabel(item: ProjectPullRequestTimelineItem) {
  if (item.kind === "commit") return "committed";
  if (item.kind === "comment") return "commented";
  if (item.kind === "review-comment") return "commented on code";
  if (item.state === "dismissed") return "had their review dismissed";
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
            {item.kind !== "commit" && item.path ? <a href={item.url} target="_blank" rel="noreferrer" className="mt-2 block truncate font-mono text-[11px] text-muted-foreground hover:text-white" title={item.path}>{item.path}{item.line ? `:${item.line}` : ""}</a> : null}
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


  return (
      <div className="flex h-full min-h-0 flex-col bg-black text-white">
        <header className="shrink-0 border-b border-border bg-black">
          <div className="flex min-h-11 items-center gap-2 border-b border-border/60 px-3 py-2">
            {onBack ? <button type="button" onClick={onBack} aria-label="Back to pull requests" className="inline-flex size-7 items-center justify-center text-muted-foreground hover:bg-[color:var(--project-panel-soft)] hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" /></button> : null}
            <PullRequestStatus state={pullRequestState(detail)} number={detail.number} showLabel className="text-xs" />
            <span className="ml-auto min-w-0 truncate font-mono text-[10px] text-muted-foreground">updated {fullDate(detail.updatedAt)}</span>
            <a href={detail.htmlUrl} target="_blank" rel="noreferrer" aria-label="Open on GitHub" className="inline-flex size-7 shrink-0 items-center justify-center text-muted-foreground hover:bg-[color:var(--project-panel-soft)] hover:text-foreground"><ExternalLink className="size-3.5" aria-hidden="true" /></a>
          </div>

          <div className="px-4 py-3">
            <h1 className="text-base font-semibold leading-snug tracking-[-0.015em] text-foreground">{detail.title}</h1>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <Actor actor={detail.author} />
              <span aria-hidden="true">·</span>
              <span>opened {fullDate(detail.createdAt)}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex min-w-0 items-center gap-1 font-mono text-[10px]"><GitBranch className="size-3" aria-hidden="true" /><span className="max-w-48 truncate text-foreground/80" title={detail.headRef}>{detail.headRef}</span><span>→</span><span className="max-w-36 truncate">{detail.baseRef}</span></span>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-1 px-2">
            <nav className="flex min-w-0 flex-1 items-end" aria-label="Pull request views">
              {TABS.map((item) => (
                <button key={item.value} type="button" aria-current={tab === item.value ? "page" : undefined} onClick={() => setTab(item.value)} className={cn("relative h-9 px-3 text-xs font-medium text-muted-foreground hover:text-foreground", tab === item.value && "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-[color:var(--project-selected-strong)]")}>
                  {item.label}
                  {item.value === "code" ? <span className="ml-1.5 font-mono text-[9px] text-muted-foreground">{detail.changedFiles}</span> : null}
                </button>
              ))}
            </nav>
            <Button type="button" size="sm" variant="outline" className="mb-1.5 h-7 shrink-0 rounded-none px-2.5 text-[11px]" disabled={detail.state !== "open"} onClick={onOpenInAutoPR}>
              Open in AutoPR
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1">
          {tab === "summary" ? <SummaryTab detail={detail} projectId={projectId} onTimeline={() => setTab("timeline")} onCode={() => setTab("code")} /> : null}
          {tab === "timeline" ? <TimelineTab projectId={projectId} number={number} /> : null}
          {tab === "code" ? <Suspense fallback={<DetailGhost />}><PullRequestCodeTab key={detail.headSha} projectId={projectId} number={number} headSha={detail.headSha} /></Suspense> : null}
        </div>
      </div>
  );
}
