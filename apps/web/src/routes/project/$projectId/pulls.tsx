import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "@autopr/ui/components/skeleton";
import { cn } from "@autopr/ui/lib/utils";
import { useQuery as useReactQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ExternalLink,
  GitPullRequest,
  Loader2,
  Search,
} from "lucide-react";

import { useMemo, useState } from "react";


type PullState = "open" | "closed";

type PullRequest = {
  id: number;
  number: number;
  title: string;
  state: PullState;
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

type Variant = "open" | "draft" | "closed";

type FilterKey = "all" | "open" | "draft" | "closed";

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

function variantFor(pull: PullRequest): Variant {
  if (pull.draft) return "draft";
  if (pull.state === "open") return "open";
  return "closed";
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function initials(name: string): string {
  return (
    name
      .split(/[\s\-_]+/)
      .flatMap((w) => (w[0] ? [w[0]] : []))
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}


function StatusDot({ variant }: { variant: Variant }) {
  if (variant === "open") {
    return (
      <span
        className="inline-block size-1.5 shrink-0 bg-primary"
        aria-hidden="true"
      />
    );
  }

  if (variant === "draft") {
    return (
      <span
        className="inline-block size-1.5 shrink-0 border border-foreground/60 bg-transparent"
        aria-hidden="true"
      />
    );
  }

  return (
    <span
      className="inline-block size-1.5 shrink-0 bg-muted-foreground/55"
      aria-hidden="true"
    />
  );
}

function StatusLabel({ variant }: { variant: Variant }) {
  const tone =
    variant === "open"
      ? "text-primary"
      : variant === "draft"
        ? "text-foreground/75"
        : "text-muted-foreground";

  return (
    <span
      className={cn(
        "font-mono text-[10px] uppercase tracking-[0.22em] leading-none",
        tone,
      )}
    >
      {variant}
    </span>
  );
}

function MetaDot() {
  return (
    <span
      className="text-border/70 select-none"
      aria-hidden="true"
    >
      ·
    </span>
  );
}


function PullRow({ pull, index }: { pull: PullRequest; index: number }) {
  const variant = variantFor(pull);

  return (
    <a
      href={pull.htmlUrl}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "pull-row-in group relative grid items-center gap-4 px-4 py-3 transition-colors",
        "grid-cols-[2rem_auto_minmax(0,1fr)_auto] sm:grid-cols-[2rem_auto_minmax(0,1.6fr)_minmax(0,8rem)_auto]",
        "hover:bg-muted/35 focus-visible:bg-muted/35 focus-visible:outline-none",
      )}
      style={{ animationDelay: `${index * 28}ms` }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-[2px] origin-top scale-y-0 bg-primary transition-transform duration-200",
          "group-hover:scale-y-100 group-focus-visible:scale-y-100",
        )}
      />

      <span className="font-mono text-[10px] uppercase tracking-[0.18em] tabular-nums text-muted-foreground/55">
        {String(index + 1).padStart(2, "0")}
      </span>

      <span className="inline-flex items-center gap-2">
        <StatusDot variant={variant} />
        <StatusLabel variant={variant} />
      </span>

      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium leading-tight text-foreground transition-colors group-hover:text-foreground">
          {pull.title}
        </p>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] leading-none text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span className="truncate text-foreground/75">{pull.headRef}</span>
            <span className="text-muted-foreground/45">→</span>
            <span className="truncate text-muted-foreground/70">
              {pull.baseRef}
            </span>
          </span>
          <MetaDot />
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-flex size-3.5 items-center justify-center bg-muted font-mono text-[8px] font-semibold tracking-normal text-muted-foreground"
              aria-hidden="true"
            >
              {initials(pull.user)}
            </span>
            <span className="text-muted-foreground/85">{pull.user}</span>
          </span>
        </div>
      </div>

      <div className="hidden min-w-0 items-center justify-end gap-1.5 sm:flex">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/55">
          {timeAgo(pull.updatedAt)}
        </span>
        <span className="text-border/70" aria-hidden="true">·</span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/55">
          #{pull.number}
        </span>
      </div>

      <span
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center border border-transparent",
          "text-muted-foreground/55 transition",
          "group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground",
          "group-focus-visible:border-primary group-focus-visible:bg-primary group-focus-visible:text-primary-foreground",
        )}
        aria-hidden="true"
      >
        <ArrowUpRight className="size-3.5" />
      </span>
    </a>
  );
}

function PullsSkeleton() {
  return (
    <div className="border border-border bg-card">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "grid items-center gap-4 px-4 py-3",
            "grid-cols-[2rem_auto_minmax(0,1fr)_auto] sm:grid-cols-[2rem_auto_minmax(0,1.6fr)_minmax(0,8rem)_auto]",
            "border-b border-border last:border-b-0",
          )}
        >
          <Skeleton className="h-3 w-5 rounded-none" />
          <div className="flex items-center gap-2">
            <Skeleton className="size-1.5 rounded-none" />
            <Skeleton className="h-3 w-9 rounded-none" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-[62%] rounded-none" />
            <Skeleton className="h-2.5 w-[42%] rounded-none" />
          </div>
          <div className="hidden justify-end gap-2 sm:flex">
            <Skeleton className="h-3 w-10 rounded-none" />
          </div>
          <Skeleton className="size-7 rounded-none" />
        </div>
      ))}
    </div>
  );
}


function FilterTabs({
  value,
  onChange,
  counts,
}: {
  value: FilterKey;
  onChange: (next: FilterKey) => void;
  counts: Record<FilterKey, number>;
}) {
  const items: { key: FilterKey; label: string }[] = [
    { key: "all", label: "all" },
    { key: "open", label: "open" },
    { key: "draft", label: "draft" },
    { key: "closed", label: "closed" },
  ];

  return (
    <div
      role="tablist"
      aria-label="Filter pull requests"
      className="flex h-9 items-stretch border border-border bg-card"
    >
      {items.map((item, idx) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(item.key)}
            className={cn(
              "group/tab relative inline-flex items-center gap-2 px-3 font-mono text-[11px] uppercase leading-none tracking-[0.2em] transition-colors",
              idx > 0 && "border-l border-border",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <span>{item.label}</span>
            <span
              className={cn(
                "font-mono text-[10px] tabular-nums",
                active ? "text-primary" : "text-muted-foreground/55",
              )}
            >
              {String(counts[item.key]).padStart(2, "0")}
            </span>
            {active ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-2 -bottom-px h-px bg-primary"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}


function PullsPage() {
  const { projectId } = Route.useParams();

  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");

  const { data, error, isLoading } = useReactQuery({
    queryKey: ["project", projectId, "pulls"],
    queryFn: async () =>
      readJson<PullsResponse>(
        await fetch(`/api/project/${encodeURIComponent(projectId)}/pulls`),
      ),
  });

  const counts = useMemo<Record<FilterKey, number>>(() => {
    const pulls = data?.pulls ?? [];
    return {
      all: pulls.length,
      open: pulls.filter((p) => p.state === "open" && !p.draft).length,
      draft: pulls.filter((p) => p.draft).length,
      closed: pulls.filter((p) => p.state === "closed").length,
    };
  }, [data]);

  const visible = useMemo(() => {
    const pulls = data?.pulls ?? [];
    const q = query.trim().toLowerCase();
    return pulls.filter((p) => {
      const v = variantFor(p);
      if (filter !== "all" && v !== filter) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.user.toLowerCase().includes(q) ||
        p.headRef.toLowerCase().includes(q) ||
        p.baseRef.toLowerCase().includes(q) ||
        String(p.number).includes(q)
      );
    });
  }, [data, filter, query]);

  const [owner, repo] = (data?.project.repoFullName ?? "").includes("/")
    ? (data?.project.repoFullName ?? "").split("/")
    : [undefined, data?.project.repoFullName];

  return (
    <main className="pulls-shell relative flex h-full min-h-full flex-1 flex-col overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-4xl px-5 pt-8 pb-10 sm:px-8 md:px-10 md:pt-10">
       

        <header className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/55">
              
              {isLoading ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="size-2.5 animate-spin" aria-hidden="true" />
                  syncing
                </span>
              ) : error ? (
                <span className="text-destructive">error</span>
              ) : (
                <span className="tabular-nums text-muted-foreground/80">
                  {String(counts.all).padStart(3, "0")} entries
                </span>
              )}
            </p>
            <h1 className="mt-2 font-sans text-[28px] font-semibold leading-[1.05] tracking-tight text-foreground">
              pull requests
            </h1>
            <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
              {owner ? (
                <>
                  <span className="text-muted-foreground/65">{owner}</span>
                  <span className="text-muted-foreground/40">/</span>
                  <span className="text-foreground/85">{repo}</span>
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  loading repository…
                </span>
              )}
            </p>
          </div>

          {data?.project.githubUrl ? (
            <a
              href={`${data.project.githubUrl}/pulls`}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 border border-border bg-card px-3",
                "font-mono text-[10px] uppercase leading-none tracking-[0.22em] text-muted-foreground transition",
                "hover:border-primary hover:bg-primary hover:text-primary-foreground",
                "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
              )}
            >
              view on github
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          ) : null}
        </header>

        {!isLoading && data ? (
          <dl
            className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border pb-4 font-mono text-[11px] uppercase tracking-[0.2em]"
            aria-label="Pull request stats"
          >
            <div className="inline-flex items-center gap-2">
              <StatusDot variant="open" />
              <dt className="text-muted-foreground">open</dt>
              <dd className="tabular-nums text-foreground">
                {String(counts.open).padStart(2, "0")}
              </dd>
            </div>
            <div className="inline-flex items-center gap-2">
              <StatusDot variant="draft" />
              <dt className="text-muted-foreground">draft</dt>
              <dd className="tabular-nums text-foreground">
                {String(counts.draft).padStart(2, "0")}
              </dd>
            </div>
            <div className="inline-flex items-center gap-2">
              <StatusDot variant="closed" />
              <dt className="text-muted-foreground">closed</dt>
              <dd className="tabular-nums text-foreground">
                {String(counts.closed).padStart(2, "0")}
              </dd>
            </div>
            <div className="ml-auto inline-flex items-center gap-2">
              <dt className="text-muted-foreground/60">total</dt>
              <dd className="tabular-nums text-muted-foreground/80">
                {String(counts.all).padStart(2, "0")}
              </dd>
            </div>
          </dl>
        ) : null}

        {!isLoading && data && counts.all > 0 ? (
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <FilterTabs value={filter} onChange={setFilter} counts={counts} />
            <label className="relative inline-flex h-9 w-full min-w-[14rem] items-center border border-border bg-card px-2.5 text-xs focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50 sm:w-72">
              <Search
                className="size-3.5 shrink-0 text-muted-foreground/55"
                aria-hidden="true"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="filter by title, author, branch…"
                className="ml-2 h-full flex-1 bg-transparent font-mono text-[11px] tracking-normal text-foreground outline-none placeholder:text-muted-foreground/50"
                aria-label="Filter pull requests"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground transition hover:text-foreground"
                  aria-label="Clear filter"
                >
                  clear
                </button>
              ) : null}
            </label>
          </div>
        ) : null}

        <section className="mt-5">
          {isLoading ? (
            <PullsSkeleton />
          ) : error ? (
            <div className="border border-destructive/30 bg-destructive/[0.04] px-5 py-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-destructive">
                ↳ error
              </p>
              <p className="mt-2 text-sm font-medium text-foreground">
                Failed to load pull requests
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {error instanceof Error
                  ? error.message
                  : "Could not load pull requests."}
              </p>
            </div>
          ) : !data?.pulls.length ? (
            <EmptyState
              title="no pull requests"
              hint="This repository has no open or closed pull requests yet."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              title="no matching pulls"
              hint={
                query
                  ? `nothing matches "${query}" in the current filter.`
                  : `nothing to show for the "${filter}" filter.`
              }
              showReset
              onReset={() => {
                setFilter("all");
                setQuery("");
              }}
            />
          ) : (
            <div className="overflow-hidden border border-border bg-card">
              <div
                className={cn(
                  "hidden items-center gap-4 border-b border-border bg-muted/35 px-4 py-2.5",
                  "grid-cols-[2rem_auto_minmax(0,1.6fr)_minmax(0,8rem)_auto]",
                  "font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground sm:grid",
                )}
              >
                <span>#</span>
                <span>status</span>
                <span>title · refs · author</span>
                <span className="text-right">updated</span>
                <span className="text-right">open</span>
              </div>

              <div className="divide-y divide-border">
                {visible.map((pull, i) => (
                  <PullRow key={pull.id} pull={pull} index={i} />
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-border bg-muted/25 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                <span>
                  showing{" "}
                  <span className="tabular-nums text-foreground">
                    {String(visible.length).padStart(2, "0")}
                  </span>{" "}
                  / {String(counts.all).padStart(2, "0")}
                </span>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}


function EmptyState({
  title,
  hint,
  showReset,
  onReset,
}: {
  title: string;
  hint: string;
  showReset?: boolean;
  onReset?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center border border-dashed border-border bg-card/30 px-8 py-16 text-center">
      <div
        className="grid size-10 place-items-center border border-border bg-card font-mono text-xs text-muted-foreground/70"
        aria-hidden="true"
      >
        <GitPullRequest className="size-4" strokeWidth={1.5} />
      </div>
      <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.22em] text-foreground">
        {title}
      </p>
      <p className="mt-1.5 max-w-xs font-mono text-[11px] leading-relaxed text-muted-foreground">
        {hint}
      </p>
      {showReset && onReset ? (
        <button
          type="button"
          onClick={onReset}
          className={cn(
            "mt-4 inline-flex h-7 items-center border border-border bg-card px-2.5",
            "font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground transition",
            "hover:border-primary hover:bg-primary hover:text-primary-foreground",
          )}
        >
          reset filters
        </button>
      ) : null}
    </div>
  );
}

export const Route = createFileRoute("/project/$projectId/pulls")({ component: PullsPage });
