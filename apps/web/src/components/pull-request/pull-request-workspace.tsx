import { Skeleton } from "@autopr/ui/components/skeleton";
import { cn } from "@autopr/ui/lib/utils";
import { ArrowUpRight, ExternalLink, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Loader2, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { OpenGithubPullRequestDialog } from "#/components/github/open-pull-request-dialog";
import { type ProjectPullRequest, useProjectPullRequests } from "#/lib/project-pull-requests";
import { PullRequestDetail } from "./pull-request-detail";

type Filter = "all" | "open" | "draft" | "closed";

const EMPTY_PULLS: ProjectPullRequest[] = [];

function relativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function pullVariant(pull: ProjectPullRequest): Exclude<Filter, "all"> {
  return pull.draft ? "draft" : pull.state;
}

function StateGlyph({ pull }: { pull: ProjectPullRequest }) {
  const variant = pullVariant(pull);
  const Icon = variant === "open" ? GitPullRequest : variant === "draft" ? GitPullRequestDraft : GitPullRequestClosed;
  return (
    <Icon
      aria-label={variant}
      className={cn(
        "size-4 shrink-0",
        variant === "open" && "text-[color:var(--cohere-deep-green)] dark:text-[color:var(--cohere-pale-green)]",
        variant === "draft" && "text-muted-foreground",
        variant === "closed" && "text-[color:var(--cohere-coral)]",
      )}
    />
  );
}

function PullRow({ pull, selected, onSelect }: { pull: ProjectPullRequest; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 px-3 py-3 text-left transition-colors",
        selected ? "bg-[color:var(--project-selected)]" : "hover:bg-[color:color-mix(in_srgb,var(--project-panel-soft)_65%,transparent)]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[color:var(--cohere-form-focus)]",
      )}
    >
      <StateGlyph pull={pull} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium leading-snug text-foreground">{pull.title}</span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <span className="shrink-0">#{pull.number}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{pull.user}</span>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate" title={`${pull.headRef} to ${pull.baseRef}`}>{pull.headRef} → {pull.baseRef}</span>
        </span>
      </span>
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{relativeTime(pull.updatedAt)}</span>
    </button>
  );
}

function ListGhost() {
  return (
    <div>
      {Array.from({ length: 7 }).map((_, index) => (
        <div key={index} className="flex items-start gap-3 border-b border-border/60 px-3 py-3">
          <Skeleton className="size-4 rounded-xs" />
          <div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-3 w-4/5 rounded-xs" /><Skeleton className="h-2.5 w-3/5 rounded-xs" /></div>
          <Skeleton className="h-3 w-7 rounded-xs" />
        </div>
      ))}
    </div>
  );
}

function EmptyList({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex min-h-60 flex-col items-center justify-center px-8 text-center">
      <GitPullRequest className="size-5 text-muted-foreground/50" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-foreground">{filtered ? "No matching pull requests" : "No pull requests yet"}</p>
      <p className="mt-1 max-w-64 text-xs leading-relaxed text-muted-foreground">{filtered ? "Try a different state or search term." : "Pull requests from this repository will appear here."}</p>
    </div>
  );
}

function PullList({
  pulls,
  selectedNumber,
  filter,
  query,
  onFilter,
  onQuery,
  onSelect,
}: {
  pulls: ProjectPullRequest[];
  selectedNumber?: number;
  filter: Filter;
  query: string;
  onFilter: (filter: Filter) => void;
  onQuery: (query: string) => void;
  onSelect: (pull: ProjectPullRequest) => void;
}) {
  const counts = useMemo(() => {
    const tally = {
      all: pulls.length,
      open: 0,
      draft: 0,
      closed: 0,
    } satisfies Record<Filter, number>;
    for (const pull of pulls) {
      tally[pullVariant(pull)] += 1;
    }
    return tally;
  }, [pulls]);
  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return pulls.filter((pull) => {
      if (filter !== "all" && pullVariant(pull) !== filter) return false;
      if (!normalizedQuery) return true;
      return [pull.title, pull.user, pull.headRef, pull.baseRef, String(pull.number)].some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [filter, pulls, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border p-3">
        <label className="flex h-8 items-center gap-2 border border-border bg-background px-2.5 focus-within:border-[color:var(--cohere-form-focus)]">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search pull requests" aria-label="Search pull requests" className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60" />
          {query ? <button type="button" onClick={() => onQuery("")} className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground">Clear</button> : null}
        </label>
        <div className="mt-2 flex items-center gap-1 overflow-x-auto" aria-label="Filter pull requests">
          {(["all", "open", "draft", "closed"] as const).map((item) => (
            <button key={item} type="button" aria-pressed={filter === item} onClick={() => onFilter(item)} className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 font-mono text-[9px] uppercase tracking-[0.12em]", filter === item ? "bg-foreground text-background" : "text-muted-foreground hover:bg-[color:var(--project-panel-soft)] hover:text-foreground")}>
              {item}<span className="tabular-nums opacity-65">{counts[item]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="minimal-scrollbar min-h-0 flex-1 overflow-y-auto">
        {visible.length > 0 ? visible.map((pull) => <PullRow key={pull.id} pull={pull} selected={pull.number === selectedNumber} onSelect={() => onSelect(pull)} />) : <EmptyList filtered={pulls.length > 0} />}
      </div>
      <div className="flex h-9 shrink-0 items-center justify-between border-t border-border px-3 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        <span>{visible.length} shown</span><span>{counts.all} total</span>
      </div>
    </div>
  );
}

export function PullRequestWorkspace({
  projectId,
  currentPullRequestNumber,
  variant = "page",
}: {
  projectId: string;
  currentPullRequestNumber?: number;
  variant?: "page" | "panel";
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  // `undefined` follows the thread's current PR as it arrives; `null` means the reader
  // explicitly returned to the list and should not be pulled back into the detail.
  const [selectedOverride, setSelectedOverride] = useState<number | null>();
  const [openReference, setOpenReference] = useState<string>();
  const listQuery = useProjectPullRequests(projectId);
  const pulls = listQuery.data?.pulls ?? EMPTY_PULLS;
  const selectedNumber = selectedOverride === undefined ? currentPullRequestNumber : selectedOverride ?? undefined;
  const panelShowingDetail = variant === "panel" && selectedNumber !== undefined;

  const list = (
    <PullList pulls={pulls} selectedNumber={selectedNumber} filter={filter} query={search} onFilter={setFilter} onQuery={setSearch} onSelect={(pull) => setSelectedOverride(pull.number)} />
  );

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-background", variant === "page" && "pull-request-workspace")}>
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <span className="inline-flex size-8 shrink-0 items-center justify-center border border-border bg-[color:var(--project-panel-soft)]"><GitPullRequest className="size-4 text-foreground/80" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-foreground">Pull requests</h1>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{listQuery.data?.project.repoFullName ?? "Loading repository…"}</p>
        </div>
        {listQuery.isFetching ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Refreshing pull requests" /> : null}
        <button type="button" onClick={() => void listQuery.refetch()} disabled={listQuery.isFetching} className="inline-flex size-8 items-center justify-center border border-border text-muted-foreground hover:bg-[color:var(--project-panel-soft)] hover:text-foreground disabled:opacity-50" aria-label="Refresh pull requests"><RefreshCw className="size-3.5" aria-hidden="true" /></button>
        {variant === "page" && listQuery.data?.project.githubUrl ? <a href={`${listQuery.data.project.githubUrl}/pulls`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 border border-border px-2.5 text-xs text-muted-foreground hover:bg-[color:var(--project-panel-soft)] hover:text-foreground">GitHub <ExternalLink className="size-3.5" aria-hidden="true" /></a> : null}
      </header>

      {listQuery.isPending ? <div className="min-h-0 flex-1 overflow-hidden"><ListGhost /></div> : listQuery.error ? (
        <div className="m-4 border border-destructive/30 bg-destructive/[0.04] p-4" role="alert"><p className="text-sm font-medium text-destructive">GitHub is unavailable</p><p className="mt-1 text-xs text-muted-foreground">{listQuery.error.message}</p></div>
      ) : variant === "panel" ? (
        panelShowingDetail ? (
          <div className="min-h-0 flex-1"><PullRequestDetail key={selectedNumber} projectId={projectId} number={selectedNumber} onBack={() => setSelectedOverride(null)} onOpenInAutoPR={() => setOpenReference(String(selectedNumber))} /></div>
        ) : list
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,340px)_minmax(0,1fr)] max-md:grid-cols-1">
          <aside className={cn("min-h-0 border-r border-border", selectedNumber !== undefined && "max-md:hidden")}>{list}</aside>
          <section className={cn("min-h-0", selectedNumber === undefined && "max-md:hidden")}>
            {selectedNumber !== undefined ? (
              <PullRequestDetail key={selectedNumber} projectId={projectId} number={selectedNumber} onBack={() => setSelectedOverride(null)} onOpenInAutoPR={() => setOpenReference(String(selectedNumber))} />
            ) : (
              <div className="grid h-full place-items-center bg-[radial-gradient(circle_at_center,color-mix(in_srgb,var(--project-panel-soft)_70%,transparent)_0,transparent_62%)] px-8 text-center">
                <div className="max-w-sm"><GitPullRequest className="mx-auto size-6 text-muted-foreground/45" aria-hidden="true" /><h2 className="mt-4 text-base font-medium text-foreground">Select a pull request to review</h2><p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">Read the description, follow the activity, and inspect every changed file without leaving AutoPR.</p>{pulls.length > 0 ? <button type="button" onClick={() => setSelectedOverride(pulls[0]?.number)} className="mt-4 inline-flex h-8 items-center gap-1.5 border border-border px-3 text-xs text-foreground hover:bg-[color:var(--project-panel-soft)]">Open most recent <ArrowUpRight className="size-3.5" aria-hidden="true" /></button> : null}</div>
              </div>
            )}
          </section>
        </div>
      )}

      <OpenGithubPullRequestDialog projectId={projectId} open={openReference !== undefined} onOpenChange={(open) => { if (!open) setOpenReference(undefined); }} initialReference={openReference ?? ""} />
    </div>
  );
}
