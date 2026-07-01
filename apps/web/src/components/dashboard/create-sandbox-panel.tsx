import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@autopr/ui/components/pagination";
import { cn } from "@autopr/ui/lib/utils";
import {
  ArrowRight,
  Check,
  GitBranch,
  Github,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Unlock,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { GithubBranch, GithubRepository } from "./types";

const REPOS_PER_PAGE = 7;

interface CreateSandboxPanelProps {
  isGithubConnected: boolean;
  isConnectingGithub: boolean;
  isLoadingRepos: boolean;
  isRefreshingRepos: boolean;
  isLoadingBranches: boolean;
  isCreating: boolean;
  repositories: GithubRepository[];
  filteredRepositories: GithubRepository[];
  branches: GithubBranch[];
  selectedRepoFullName: string;
  selectedBranch: string;
  repoSearch: string;
  selectedRepo: GithubRepository | undefined;
  error?: string;
  onConnectGithub: () => void;
  onRefreshRepos: () => void;
  onRepoSearchChange: (value: string) => void;
  onRepoChange: (value: string) => void;
  onBranchChange: (value: string) => void;
  onCreate: () => void;
}

export function CreateSandboxPanel(props: CreateSandboxPanelProps) {
  const {
    isGithubConnected,
    isConnectingGithub,
    isLoadingRepos,
    isRefreshingRepos,
    isLoadingBranches,
    isCreating,
    filteredRepositories,
    repositories,
    branches,
    selectedRepoFullName,
    selectedBranch,
    repoSearch,
    selectedRepo,
    error,
    onConnectGithub,
    onRefreshRepos,
    onRepoSearchChange,
    onRepoChange,
    onBranchChange,
    onCreate,
  } = props;

  const repoDone = Boolean(selectedRepo);
  const branchDone = Boolean(selectedRepo && selectedBranch);
  const launchReady = repoDone && branchDone && !isCreating && !isLoadingBranches;

  return (
    <section className="rounded-sm border border-border bg-card text-card-foreground">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-medium text-foreground">
            Create a sandbox
          </h2>
          <FlowTrack
            githubDone={isGithubConnected}
            repoDone={repoDone}
            branchDone={branchDone}
          />
        </div>
        {isGithubConnected ? (
          <button
            type="button"
            onClick={() => void onRefreshRepos()}
            disabled={isLoadingRepos || isCreating}
            className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground transition hover:text-foreground disabled:opacity-40"
          >
            <RefreshCw
              className={cn(
                "size-3",
                (isLoadingRepos || isRefreshingRepos) && "animate-spin",
              )}
              aria-hidden="true"
            />
            {isRefreshingRepos ? "syncing" : "refresh"}
          </button>
        ) : null}
      </div>

      {!isGithubConnected ? (
        <ConnectStep
          isConnecting={isConnectingGithub}
          onConnect={onConnectGithub}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr_1fr]">
          <RepoColumn
            isLoading={isLoadingRepos}
            isRefreshing={isRefreshingRepos}
            isDisabled={isCreating}
            search={repoSearch}
            onSearchChange={onRepoSearchChange}
            repositories={filteredRepositories}
            allCount={repositories.length}
            selectedFullName={selectedRepoFullName}
            onSelect={onRepoChange}
          />
          <BranchColumn
            isLoading={isLoadingBranches}
            isDisabled={!selectedRepo || isCreating}
            branches={branches}
            defaultBranch={selectedRepo?.defaultBranch}
            selected={selectedBranch}
            onSelect={onBranchChange}
          />
          <LaunchColumn
            selectedRepo={selectedRepo}
            selectedBranch={selectedBranch}
            isCreating={isCreating}
            launchReady={launchReady}
            onCreate={onCreate}
          />
        </div>
      )}

      {error ? (
        <div
          role="alert"
          className="border-t border-destructive/40 px-5 py-3 font-mono text-xs text-destructive sm:px-7"
        >
          <span className="mr-2 uppercase tracking-[0.2em]">err</span>
          <span className="text-destructive/90">{error}</span>
        </div>
      ) : null}
    </section>
  );
}


function FlowTrack({
  githubDone,
  repoDone,
  branchDone,
}: {
  githubDone: boolean;
  repoDone: boolean;
  branchDone: boolean;
}) {
  const steps = [
    { label: "github", done: githubDone, active: !githubDone },
    { label: "repo", done: repoDone, active: githubDone && !repoDone },
    { label: "branch", done: branchDone, active: repoDone && !branchDone },
    { label: "launch", done: false, active: branchDone },
  ];
  return (
    <ol className="hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] md:flex">
      {steps.map((step, i) => {
        const state = step.done ? "done" : step.active ? "active" : "idle";
        return (
          <li key={step.label} className="flex items-center gap-1.5">
            {i > 0 ? (
              <span className="text-muted-foreground/40">·</span>
            ) : null}
            <span
              className={cn(
                "inline-flex size-3.5 items-center justify-center border leading-none",
                state === "done" && "border-primary bg-primary text-primary-foreground",
                state === "active" && "border-primary text-primary",
                state === "idle" && "border-border text-muted-foreground/60",
              )}
            >
              {state === "done" ? (
                <Check className="size-2.5" strokeWidth={3} aria-hidden="true" />
              ) : null}
            </span>
            <span
              className={cn(
                state === "active" && "text-primary",
                state === "done" && "text-muted-foreground",
                state === "idle" && "text-muted-foreground/60",
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}


function ConnectStep({
  isConnecting,
  onConnect,
}: {
  isConnecting: boolean;
  onConnect: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-4 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-md space-y-1.5">
        <h3 className="text-base font-medium text-foreground">
          Link a GitHub account to begin.
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          We pull both public and private repositories so you can boot a sandbox.
        </p>
      </div>
      <button
        type="button"
        onClick={onConnect}
        disabled={isConnecting}
        className={cn(
          "group inline-flex h-10 items-center gap-2 rounded-[var(--radius-pill)] border border-primary bg-primary px-5 type-button text-primary-foreground transition",
          "hover:bg-primary/90",
          "disabled:cursor-not-allowed disabled:opacity-40",
        )}
      >
        {isConnecting ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Github className="size-3.5" aria-hidden="true" />
        )}
        connect github
      </button>
    </div>
  );
}


function ColumnHeader({
  label,
  hint,
}: {
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-3 py-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-foreground">
        {label}
      </span>
      {hint ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
          {hint}
        </span>
      ) : null}
    </div>
  );
}


function RepoColumn({
  isLoading,
  isRefreshing,
  isDisabled,
  search,
  onSearchChange,
  repositories,
  allCount,
  selectedFullName,
  onSelect,
}: {
  isLoading: boolean;
  isRefreshing: boolean;
  isDisabled: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  repositories: GithubRepository[];
  allCount: number;
  selectedFullName: string;
  onSelect: (v: string) => void;
}) {
  return (
    <RepoColumnPager
      key={search}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      isDisabled={isDisabled}
      search={search}
      onSearchChange={onSearchChange}
      repositories={repositories}
      allCount={allCount}
      selectedFullName={selectedFullName}
      onSelect={onSelect}
    />
  );
}

function RepoColumnPager({
  isLoading,
  isRefreshing,
  isDisabled,
  search,
  onSearchChange,
  repositories,
  allCount,
  selectedFullName,
  onSelect,
}: {
  isLoading: boolean;
  isRefreshing: boolean;
  isDisabled: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  repositories: GithubRepository[];
  allCount: number;
  selectedFullName: string;
  onSelect: (v: string) => void;
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(repositories.length / REPOS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);

  const pageRepos = useMemo(() => {
    const start = (currentPage - 1) * REPOS_PER_PAGE;
    return repositories.slice(start, start + REPOS_PER_PAGE);
  }, [repositories, currentPage]);

  return (
    <div className="flex h-[22rem] flex-col border-b border-border lg:border-b-0 lg:border-r">
      <ColumnHeader
        label="Repository"
        hint={
          isLoading
            ? "loading"
            : isRefreshing
              ? "syncing"
              : `${repositories.length}/${allCount}`
        }
      />
      <div className="border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-2 rounded-xs border border-border bg-background px-2 focus-within:border-[color:var(--cohere-form-focus)] focus-within:ring-1 focus-within:ring-ring/30">
          <Search className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <input
            aria-label="Search repositories"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="search…"
            disabled={isDisabled}
            className="h-7 w-full bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
          />
        </div>
      </div>

      <div
        className={cn(
          "minimal-scrollbar relative min-h-0 flex-1 overflow-y-auto",
          isDisabled && "opacity-60",
        )}
      >
        {isLoading ? (
          <ColumnState>
            <RepositorySkeleton />
          </ColumnState>
        ) : repositories.length === 0 ? (
          <ColumnState>
            <span className="font-mono text-[11px] uppercase tracking-[0.2em]">
              no matches
            </span>
            <span className="text-xs text-muted-foreground/70">
              {search ? "Try a different search." : "No repositories returned."}
            </span>
          </ColumnState>
        ) : (
          <ul className={cn("divide-y divide-border/60", isRefreshing && "opacity-80")}>
            {pageRepos.map((repo) => {
              const active = repo.fullName === selectedFullName;
              return (
                <li key={repo.id}>
                  <button
                    type="button"
                    disabled={isDisabled}
                    onClick={() => onSelect(repo.fullName)}
                    className={cn(
                      "group flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition",
                      "hover:bg-muted/50",
                      active && "bg-[color:var(--project-selected)] text-[color:var(--project-selected-strong)] hover:bg-[color:var(--project-selected)]",
                    )}
                  >
                    {repo.private ? (
                      <Lock
                        className={cn(
                          "size-3.5 shrink-0",
                          active ? "text-[color:var(--project-selected-strong)]" : "text-muted-foreground/70",
                        )}
                        aria-hidden="true"
                      />
                    ) : (
                      <Unlock
                        className={cn(
                          "size-3.5 shrink-0",
                          active ? "text-[color:var(--project-selected-strong)]" : "text-muted-foreground/70",
                        )}
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      <span
                        className={cn(
                          active ? "text-[color:var(--project-selected-strong)]" : "text-muted-foreground/70",
                        )}
                      >
                        {repo.owner}
                        <span className="opacity-50">/</span>
                      </span>
                      <span className="font-medium">{repo.name}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {isRefreshing && !isLoading ? (
          <div className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-xs border border-border bg-background/95 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground shadow-none">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            syncing
          </div>
        ) : null}
      </div>

      {!isLoading && repositories.length > REPOS_PER_PAGE ? (
        <RepoPagination
          page={currentPage}
          totalPages={totalPages}
          onChange={setPage}
        />
      ) : null}
    </div>
  );
}

function RepoPagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  const pages = useMemo(() => buildPageWindow(page, totalPages), [page, totalPages]);

  return (
    <div className="border-t border-border bg-muted/30 px-2 py-1.5">
      <Pagination className="justify-between">
        <PaginationContent className="gap-0.5">
          <PaginationItem>
            <PaginationPrevious
              text=""
              aria-disabled={page <= 1}
              className={cn(
                "h-7 px-1.5",
                page <= 1 && "pointer-events-none opacity-40",
              )}
              onClick={(e) => {
                e.preventDefault();
                if (page > 1) onChange(page - 1);
              }}
              href={page > 1 ? `?page=${page - 1}` : "?page=1"}
            />
          </PaginationItem>

          {pages.map((p, position) =>
            p === "…" ? (
              <PaginationItem key={position < pages.length / 2 ? "gap-start" : "gap-end"}>
                <span className="inline-flex h-7 items-center px-1 font-mono text-[10px] text-muted-foreground/60">
                  …
                </span>
              </PaginationItem>
            ) : (
              <PaginationItem key={p}>
                <PaginationLink
                  href={`?page=${p}`}
                  isActive={p === page}
                  size="sm"
                  className="h-7 min-w-7 font-mono text-[11px]"
                  onClick={(e) => {
                    e.preventDefault();
                    onChange(p);
                  }}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ),
          )}

          <PaginationItem>
            <PaginationNext
              text=""
              aria-disabled={page >= totalPages}
              className={cn(
                "h-7 px-1.5",
                page >= totalPages && "pointer-events-none opacity-40",
              )}
              onClick={(e) => {
                e.preventDefault();
                if (page < totalPages) onChange(page + 1);
              }}
              href={page < totalPages ? `?page=${page + 1}` : `?page=${totalPages}`}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}

function buildPageWindow(page: number, total: number): Array<number | "…"> {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const window: Array<number | "…"> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(total - 1, page + 1);
  if (start > 2) window.push("…");
  for (let i = start; i <= end; i++) window.push(i);
  if (end < total - 1) window.push("…");
  window.push(total);
  return window;
}

function BranchColumn({
  isLoading,
  isDisabled,
  branches,
  defaultBranch,
  selected,
  onSelect,
}: {
  isLoading: boolean;
  isDisabled: boolean;
  branches: GithubBranch[];
  defaultBranch?: string;
  selected: string;
  onSelect: (v: string) => void;
}) {
  return (
    <div className="flex h-[22rem] flex-col border-b border-border lg:border-b-0 lg:border-r">
      <ColumnHeader
        label="Branch"
        hint={isLoading ? "loading" : branches.length ? `${branches.length}` : undefined}
      />
      <div
        className={cn(
          "minimal-scrollbar relative min-h-0 flex-1 overflow-y-auto",
          isDisabled && "opacity-50",
        )}
      >
        {isDisabled && !isLoading ? (
          <ColumnState>
            <span className="font-mono text-[11px] uppercase tracking-[0.2em]">
              awaiting repo
            </span>
            <span className="text-xs text-muted-foreground/70">
              Pick a repository to load its branches.
            </span>
          </ColumnState>
        ) : isLoading ? (
          <ColumnState>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <span>loading branches</span>
          </ColumnState>
        ) : branches.length === 0 ? (
          <ColumnState>
            <span className="font-mono text-[11px] uppercase tracking-[0.2em]">
              no branches
            </span>
          </ColumnState>
        ) : (
          <ul className="divide-y divide-border/60">
            {branches.map((branch) => {
              const active = branch.name === selected;
              const isDefault = branch.name === defaultBranch;
              return (
                <li key={branch.sha}>
                  <button
                    type="button"
                    onClick={() => onSelect(branch.name)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition",
                      "hover:bg-muted/50",
                      active && "bg-[color:var(--project-selected)] text-[color:var(--project-selected-strong)] hover:bg-[color:var(--project-selected)]",
                    )}
                  >
                    <GitBranch
                      className={cn(
                        "size-3.5 shrink-0",
                        active ? "text-[color:var(--project-selected-strong)]" : "text-muted-foreground/70",
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">
                      {branch.name}
                    </span>
                    {isDefault ? (
                      <span
                        className={cn(
                          "shrink-0 border px-1.5 font-mono text-[9px] uppercase tracking-[0.18em]",
                          active
                            ? "border-[color:var(--project-selected-strong)]/40 text-[color:var(--project-selected-strong)]"
                            : "border-border/80 text-muted-foreground/70",
                        )}
                      >
                        default
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function LaunchColumn({
  selectedRepo,
  selectedBranch,
  isCreating,
  launchReady,
  onCreate,
}: {
  selectedRepo: GithubRepository | undefined;
  selectedBranch: string;
  isCreating: boolean;
  launchReady: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="flex h-[22rem] flex-col">
      <ColumnHeader label="Launch" hint={launchReady ? "ready" : "—"} />
      <div className="flex flex-1 flex-col justify-between gap-3 p-3">
        <dl className="space-y-2 font-mono text-xs">
          <SummaryRow
            label="repo"
            value={selectedRepo?.fullName}
            placeholder="not selected"
          />
          <SummaryRow
            label="branch"
            value={selectedBranch}
            placeholder="not selected"
          />
          <SummaryRow
            label="access"
            value={
              selectedRepo
                ? selectedRepo.private
                  ? "private"
                  : "public"
                : undefined
            }
            placeholder="—"
          />
        </dl>

        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => void onCreate()}
            disabled={!launchReady}
            className={cn(
              "group inline-flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] border type-button transition",
              launchReady
                ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                : "cursor-not-allowed border-border bg-muted/40 text-muted-foreground/60",
            )}
          >
            {isCreating ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                booting
              </>
            ) : (
              <>
                create sandbox
                <ArrowRight
                  className="size-3.5 transition-transform group-enabled:group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </>
            )}
          </button>
          {selectedRepo ? (
            <a
              href={selectedRepo.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="block text-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground transition hover:text-foreground"
            >
              view on github ↗
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  placeholder,
}: {
  label: string;
  value?: string | null;
  placeholder: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-border/60 pb-1.5">
      <dt className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "truncate text-right",
          value ? "text-foreground" : "text-muted-foreground/50",
        )}
        title={value ?? undefined}
      >
        {value || placeholder}
      </dd>
    </div>
  );
}

function ColumnState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 py-8 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function RepositorySkeleton() {
  return (
    <div className="w-full max-w-xs space-y-2" aria-label="Loading repositories">
      {Array.from({ length: 5 }, (_, index) => `repo-skeleton-${index}`).map((skeletonId) => (
        <div key={skeletonId} className="flex items-center gap-2.5">
          <span className="size-3.5 shrink-0 animate-pulse border border-border bg-muted" />
          <span className="h-3 flex-1 animate-pulse bg-muted" />
        </div>
      ))}
    </div>
  );
}
