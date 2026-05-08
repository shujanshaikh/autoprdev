"use client";

import { Badge } from "@autopr/ui/components/badge";
import { Skeleton } from "@autopr/ui/components/skeleton";
import { useQuery as useReactQuery } from "@tanstack/react-query";
import {
  GitPullRequest,
  Loader2,
  ExternalLink,
  ArrowRight,
  GitBranch,
  Clock,
  GitMerge,
  GitPullRequestDraft,
  CircleDot,
} from "lucide-react";
import { useParams } from "next/navigation";

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error =
      data && typeof data === "object" && "error" in data
        ? String(data.error)
        : "Request failed.";
    throw new Error(error);
  }
  return data as T;
}

type PullRequest = {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  htmlUrl: string;
  user: string;
  updatedAt: string;
  draft: boolean;
  headRef: string;
  baseRef: string;
};

type PullsResponse = {
  project: { projectId: string; repoFullName: string; githubUrl: string };
  pulls: PullRequest[];
};

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function initials(name: string): string {
  return name
    .split(/[\s-_]+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function avatarColor(name: string): string {
  const hue =
    name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return `oklch(0.72 0.14 ${hue})`;
}

function avatarBg(name: string): string {
  const hue =
    name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return `oklch(0.94 0.04 ${hue})`;
}

function StatusIcon({
  state,
  draft,
}: {
  state: PullRequest["state"];
  draft: boolean;
}) {
  if (draft)
    return (
      <GitPullRequestDraft
        className="size-4 text-amber-500/80"
        aria-hidden="true"
      />
    );
  if (state === "open")
    return (
      <CircleDot className="size-4 text-emerald-500/90" aria-hidden="true" />
    );
  return <GitMerge className="size-4 text-violet-500/80" aria-hidden="true" />;
}

function StatusBar({
  state,
  draft,
}: {
  state: PullRequest["state"];
  draft: boolean;
}) {
  let colorClass = "";
  if (draft) colorClass = "bg-amber-500/60";
  else if (state === "open") colorClass = "bg-emerald-500/70";
  else colorClass = "bg-violet-500/60";

  return (
    <div
      className={`absolute left-0 top-4 bottom-4 w-[2px] rounded-full transition-all duration-300 group-hover:top-3 group-hover:bottom-3 group-hover:w-[3px] ${colorClass}`}
      aria-hidden="true"
    />
  );
}

function PullRow({
  pull,
  index,
}: {
  pull: PullRequest;
  index: number;
}) {
  return (
    <a
      key={pull.id}
      href={pull.htmlUrl}
      target="_blank"
      rel="noreferrer"
      className="group pull-row-in relative flex items-start gap-5 border-b border-border/30 px-6 py-3.5 transition-all duration-200 last:border-b-0 hover:bg-muted/[0.35]"
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <StatusBar state={pull.state} draft={pull.draft} />

      <div className="shrink-0">
        <StatusIcon state={pull.state} draft={pull.draft} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h2 className="truncate text-[15px] font-medium tracking-tight text-foreground transition-colors group-hover:text-foreground/80">
            {pull.title}
          </h2>
          {pull.draft && (
            <Badge
              variant="outline"
              className="h-4 rounded-none border-amber-500/25 bg-amber-500/[0.06] px-1.5 text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400"
            >
              Draft
            </Badge>
          )}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground/70">
          <span className="inline-flex items-center gap-1.5">
            <GitBranch className="size-3 text-muted-foreground/40" aria-hidden="true" />
            <span className="text-muted-foreground/90">{pull.headRef}</span>
          </span>

          <ArrowRight className="size-3 text-muted-foreground/30" aria-hidden="true" />

          <span className="text-muted-foreground/60">{pull.baseRef}</span>

          <span className="text-border/80" aria-hidden="true">·</span>

          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-flex size-4 items-center justify-center text-[8px] font-bold"
              style={{
                backgroundColor: avatarBg(pull.user),
                color: avatarColor(pull.user),
              }}
              aria-hidden="true"
            >
              {initials(pull.user)}
            </span>
            <span>{pull.user}</span>
          </span>

          <span className="text-border/80" aria-hidden="true">·</span>

          <span className="inline-flex items-center gap-1">
            <Clock className="size-3 text-muted-foreground/30" aria-hidden="true" />
            {timeAgo(pull.updatedAt)}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground/40 transition-colors group-hover:text-muted-foreground/60">
          #{pull.number}
        </span>
        <ExternalLink className="size-3.5 text-muted-foreground/25 transition-all duration-200 group-hover:text-muted-foreground/60 group-hover:translate-x-px group-hover:-translate-y-px" aria-hidden="true" />
      </div>
    </a>
  );
}

function PullsSkeleton() {
  return (
    <div className="border border-border/40">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-start gap-5 border-b border-border/30 px-6 py-3.5 last:border-b-0"
        >
          <div>
            <Skeleton className="size-4" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-[65%]" />
            <Skeleton className="h-3 w-[40%]" />
          </div>
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </div>
  );
}

export default function PullsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const { data, error, isLoading } = useReactQuery({
    queryKey: ["project", projectId, "pulls"],
    queryFn: async () =>
      readJson<PullsResponse>(
        await fetch(`/api/project/${encodeURIComponent(projectId)}/pulls`)
      ),
  });

  const openCount =
    data?.pulls.filter((p) => p.state === "open" && !p.draft).length ?? 0;
  const draftCount = data?.pulls.filter((p) => p.draft).length ?? 0;
  const closedCount =
    data?.pulls.filter((p) => p.state === "closed").length ?? 0;

  return (
    <main className="pulls-shell min-h-full bg-background px-5 py-8 md:px-10 md:py-10">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-10 flex items-end justify-between gap-6">
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60">
              Repository
            </p>
            <h1 className="mt-2 text-[28px] font-light tracking-tight text-foreground">
              Pull requests
            </h1>
            <p className="mt-1.5 font-mono text-xs text-muted-foreground/60">
              {data?.project.repoFullName ?? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-3 animate-spin" />
                  Loading repository…
                </span>
              )}
            </p>
          </div>

          {data?.project.githubUrl ? (
            <a
              href={`${data.project.githubUrl}/pulls`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 shrink-0 items-center gap-1.5 border border-border bg-background px-2.5 text-xs font-medium text-foreground whitespace-nowrap transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-3.5"
            >
              GitHub
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </div>

        {/* Stats */}
        {!isLoading && data && (
          <div className="mb-6 flex items-center gap-2">
            {openCount > 0 && (
              <Badge
                variant="secondary"
                className="h-5 rounded-none border-emerald-500/15 bg-emerald-500/[0.07] px-2 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
              >
                {openCount} open
              </Badge>
            )}
            {draftCount > 0 && (
              <Badge
                variant="secondary"
                className="h-5 rounded-none border-amber-500/15 bg-amber-500/[0.07] px-2 text-[11px] font-medium text-amber-700 dark:text-amber-400"
              >
                {draftCount} draft
              </Badge>
            )}
            {closedCount > 0 && (
              <Badge
                variant="secondary"
                className="h-5 rounded-none border-violet-500/15 bg-violet-500/[0.07] px-2 text-[11px] font-medium text-violet-700 dark:text-violet-400"
              >
                {closedCount} closed
              </Badge>
            )}
            {data.pulls.length === 0 && (
              <Badge
                variant="secondary"
                className="h-5 rounded-none px-2 text-[11px] font-medium text-muted-foreground"
              >
                0 total
              </Badge>
            )}
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <PullsSkeleton />
        ) : error ? (
          <div className="border border-destructive/20 bg-destructive/[0.03] p-6 text-sm text-destructive">
            <p className="font-medium">Failed to load pull requests</p>
            <p className="mt-1 text-muted-foreground">
              {error instanceof Error
                ? error.message
                : "Could not load pull requests."}
            </p>
          </div>
        ) : !data?.pulls.length ? (
          <div className="flex flex-col items-center justify-center border border-dashed border-border/60 py-20 text-center">
            <div className="flex size-12 items-center justify-center border border-border/50 bg-muted/40">
              <GitPullRequest
                className="size-5 text-muted-foreground/40"
                strokeWidth={1.5}
                aria-hidden="true"
              />
            </div>
            <p className="mt-4 text-sm font-medium text-muted-foreground/80">
              No pull requests
            </p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground/50">
              This repository has no open or closed pull requests.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden border border-border/40">
            {data.pulls.map((pull, i) => (
              <PullRow key={pull.id} pull={pull} index={i} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
