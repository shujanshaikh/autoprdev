import { api } from "@autopr/backend/convex/_generated/api";
import { Button } from "@autopr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@autopr/ui/components/dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@autopr/ui/components/sidebar";
import { TooltipProvider } from "@autopr/ui/components/tooltip";
import { cn } from "@autopr/ui/lib/utils";
import {
  GitBranch,
  Loader2,
  Pencil,
  Plus,
  Settings,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  Link,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import {
  useMutation as useReactMutation,
  useQuery as useReactQuery,
} from "@tanstack/react-query";
import {
  useAction,
  useConvexAuth,
  useMutation as useConvexMutation,
  useQuery,
} from "convex/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";

import { WorkOSUserButton } from "#/components/auth/workos-user-button";
import { SettingsDialog, type WorkspaceUserSettings } from "#/components/settings/settings-dialog";
import { CreateSandboxPanel } from "#/components/dashboard/create-sandbox-panel";
import { DeleteDialog } from "#/components/dashboard/delete-dialog";
import { ModeToggle } from "#/components/mode-toggle";
import {
  readJson,
  type GithubBranch,
  type GithubRepository,
  type SandboxRuntimeStatus,
  type SandboxStatus,
} from "#/components/dashboard/types";
import { RouteTransition } from "#/components/route-transition";
import { useCodexStatus } from "#/lib/codex-status";
import { deleteThreadWithCleanup } from "#/lib/delete-thread";

const EMPTY_REPOSITORIES: GithubRepository[] = [];
const EMPTY_BRANCHES: GithubBranch[] = [];

export interface WorkspaceThread {
  threadId: string;
  title?: string;
  isLive?: boolean;
  updatedAt?: number;
}

interface WorkspaceProject {
  projectId: string;
  repoFullName: string;
  sandboxStatus: SandboxStatus;
  sandboxRuntimeStatus?: SandboxRuntimeStatus | null;
  currentBranch?: string | null;
  repoBranch?: string | null;
  defaultBranch?: string | null;
  lastOpenedAt?: number;
  updatedAt: number;
}

interface WorkspaceSandboxCost {
  _id: string;
  projectId: string;
  sandboxId: string;
  sandboxName?: string;
  repoFullName?: string;
  status: "active" | "pending_finalization" | "finalized";
  latestTotalPrice?: number;
  finalTotalPrice?: number;
  sandboxCreatedAt: number;
  deletedAt?: number;
}

const sidebarThreadCache = new Map<string, WorkspaceThread[]>();

function projectParts(repoFullName: string) {
  const [owner, ...rest] = repoFullName.split("/");
  return {
    owner: rest.length > 0 ? owner : undefined,
    name: rest.length > 0 ? rest.join("/") : repoFullName,
  };
}

function formatAge(timestamp?: number) {
  if (!timestamp) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

function WorkspaceCreateSandboxDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { isAuthenticated } = useConvexAuth();
  const [selectedRepoFullNameOverride, setSelectedRepoFullNameOverride] = useState<string | undefined>();
  const [selectedBranchOverride, setSelectedBranchOverride] = useState<
    { repoFullName: string; branchName: string } | undefined
  >();
  const [repoSearch, setRepoSearch] = useState("");
  const [isConnectingGithub, setIsConnectingGithub] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const repositoriesQuery = useReactQuery({
    queryKey: ["github", "repositories"],
    enabled: isAuthenticated && open,
    retry: false,
    queryFn: async () =>
      readJson<{ repositories: GithubRepository[] }>(
        await fetch("/api/github/repositories"),
      ),
  });

  const repositories = repositoriesQuery.data?.repositories ?? EMPTY_REPOSITORIES;
  const refetchRepositories = repositoriesQuery.refetch;
  const isLoadingRepos = repositoriesQuery.isPending && open;
  const isRefreshingRepos = repositoriesQuery.isFetching && !repositoriesQuery.isPending;
  const isGithubConnected = !repositoriesQuery.isError || repositories.length > 0;
  const repoError =
    repositoriesQuery.error instanceof Error
      ? repositoriesQuery.error.message
      : repositoriesQuery.isError
        ? "Could not load GitHub repositories."
        : undefined;

  const selectedRepoFullName =
    selectedRepoFullNameOverride &&
    repositories.some((repo) => repo.fullName === selectedRepoFullNameOverride)
      ? selectedRepoFullNameOverride
      : repositories[0]?.fullName ?? "";
  const selectedRepo = useMemo(
    () => repositories.find((r) => r.fullName === selectedRepoFullName),
    [repositories, selectedRepoFullName],
  );

  const filteredRepositories = useMemo(() => {
    const search = repoSearch.trim().toLowerCase();
    if (!search) return repositories;
    return repositories.filter((r) => r.fullName.toLowerCase().includes(search));
  }, [repoSearch, repositories]);

  const branchesQuery = useReactQuery({
    queryKey: ["github", "branches", selectedRepo?.owner, selectedRepo?.name],
    enabled: isAuthenticated && open && Boolean(selectedRepo),
    queryFn: async () => {
      if (!selectedRepo) {
        return { branches: EMPTY_BRANCHES };
      }

      return readJson<{ branches: GithubBranch[] }>(
        await fetch(
          `/api/github/repositories/${encodeURIComponent(selectedRepo.owner)}/${encodeURIComponent(selectedRepo.name)}/branches`,
        ),
      );
    },
  });

  const branches = branchesQuery.data?.branches ?? EMPTY_BRANCHES;
  const defaultBranchName =
    selectedRepo && branches.some((branch) => branch.name === selectedRepo.defaultBranch)
      ? selectedRepo.defaultBranch
      : branches[0]?.name ?? "";
  const selectedBranch =
    selectedBranchOverride?.repoFullName === selectedRepoFullName &&
    branches.some((branch) => branch.name === selectedBranchOverride.branchName)
      ? selectedBranchOverride.branchName
      : defaultBranchName;
  const isLoadingBranches = branchesQuery.isPending && Boolean(selectedRepo);
  const branchesError =
    branchesQuery.error instanceof Error
      ? branchesQuery.error.message
      : branchesQuery.isError
        ? "Could not load branches."
        : undefined;

  const createProjectMutation = useReactMutation({
    mutationFn: async () => {
      if (!selectedRepo || !selectedBranch) {
        throw new Error("Select a GitHub repository and branch.");
      }

      return readJson<{ projectId: string; error?: string }>(
        await fetch("/api/projects/from-github", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repository: {
              id: selectedRepo.id,
              fullName: selectedRepo.fullName,
              owner: selectedRepo.owner,
              name: selectedRepo.name,
              htmlUrl: selectedRepo.htmlUrl,
              cloneUrl: selectedRepo.cloneUrl,
              defaultBranch: selectedRepo.defaultBranch,
            },
            branch: selectedBranch,
          }),
        }),
      );
    },
    onMutate: () => {
      setError(undefined);
    },
    onSuccess: (data) => {
      onOpenChange(false);
      navigate({ to: "/project/$projectId", params: { projectId: data.projectId } });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not create the project sandbox.");
    },
  });

  const isCreating = createProjectMutation.isPending;

  const refreshRepositories = useCallback(async () => {
    setError(undefined);
    await refetchRepositories();
  }, [refetchRepositories]);

  function connectGithub() {
    setIsConnectingGithub(true);
    setError(undefined);
    window.location.assign(`/api/github/connect?returnTo=${encodeURIComponent(window.location.href)}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(46rem,calc(100svh-2rem))] overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle>Create a sandbox</DialogTitle>
          <DialogDescription>
            GitHub repository, branch, sandbox.
          </DialogDescription>
        </DialogHeader>
        <div className="minimal-scrollbar min-h-0 overflow-y-auto p-4">
          <CreateSandboxPanel
            isGithubConnected={isGithubConnected}
            isConnectingGithub={isConnectingGithub}
            isLoadingRepos={isLoadingRepos}
            isRefreshingRepos={isRefreshingRepos}
            isLoadingBranches={isLoadingBranches}
            isCreating={isCreating}
            repositories={repositories}
            filteredRepositories={filteredRepositories}
            branches={branches}
            selectedRepoFullName={selectedRepoFullName}
            selectedBranch={selectedBranch}
            repoSearch={repoSearch}
            selectedRepo={selectedRepo}
            error={error ?? repoError ?? branchesError}
            onConnectGithub={connectGithub}
            onRefreshRepos={refreshRepositories}
            onRepoSearchChange={setRepoSearch}
            onRepoChange={setSelectedRepoFullNameOverride}
            onBranchChange={(branchName) =>
              setSelectedBranchOverride({ repoFullName: selectedRepoFullName, branchName })
            }
            onCreate={() => createProjectMutation.mutate()}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceSidebar({
  projects,
  activeProjectId,
  activeThreadId,
  activeProjectThreads,
  onCreateProject,
  onDeleteProject,
  onOpenSettings,
}: {
  projects: WorkspaceProject[] | undefined;
  activeProjectId?: string;
  activeThreadId?: string;
  activeProjectThreads: WorkspaceThread[] | undefined;
  onCreateProject: () => void;
  onDeleteProject: (projectId: string) => void;
  onOpenSettings: () => void;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingThreadId, setDeletingThreadId] = useState<string | undefined>();
  const [pendingDeleteThread, setPendingDeleteThread] = useState<WorkspaceThread | undefined>();
  const [deleteThreadError, setDeleteThreadError] = useState<string | undefined>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeProjectTabRef = useRef<HTMLAnchorElement>(null);
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const activeProject = projects?.find((project) => project.projectId === activeProjectId);
  const activeProjectName = activeProject ? projectParts(activeProject.repoFullName).name : undefined;
  const activeBranch = activeProject?.currentBranch
    ?? activeProject?.repoBranch
    ?? activeProject?.defaultBranch
    ?? "main";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    activeProjectTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeProjectId]);

  const visibleThreads = useMemo(() => {
    if (!activeProjectThreads) return undefined;
    return normalizedSearch
      ? activeProjectThreads.filter((thread) =>
        `${thread.title ?? ""} ${thread.threadId}`.toLowerCase().includes(normalizedSearch),
      )
      : activeProjectThreads;
  }, [activeProjectThreads, normalizedSearch]);

  function openNewThread() {
    if (!activeProjectId) return;
    navigate({ to: "/project/$projectId", params: { projectId: activeProjectId } });
  }

  function handleDeleteThread(event: MouseEvent<HTMLButtonElement>, thread: WorkspaceThread) {
    event.preventDefault();
    event.stopPropagation();
    setPendingDeleteThread(thread);
    setDeleteThreadError(undefined);
  }

  async function confirmDeleteThread() {
    if (!pendingDeleteThread || !activeProjectId) return;

    const thread = pendingDeleteThread;
    setDeletingThreadId(thread.threadId);
    try {
      await deleteThreadWithCleanup(activeProjectId, thread.threadId);
      setPendingDeleteThread(undefined);
      if (thread.threadId === activeThreadId && activeProjectId) {
        navigate({ to: "/project/$projectId", params: { projectId: activeProjectId } });
      }
      router.invalidate();
    } catch (error) {
      setDeleteThreadError(error instanceof Error ? error.message : "Could not delete the thread.");
    } finally {
      setDeletingThreadId(undefined);
    }
  }

  return (
    <>
      <Sidebar collapsible="icon" variant="sidebar">
        <SidebarHeader className="h-12 shrink-0 justify-center gap-0 border-b border-sidebar-border/80 px-3 py-0">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger className="text-sidebar-foreground/70 hover:text-sidebar-foreground" />
            <span className="min-w-0 truncate font-display text-[13px] font-medium tracking-[-0.02em] text-sidebar-foreground group-data-[collapsible=icon]:hidden">
              AUTOPR
            </span>
          </div>
        </SidebarHeader>

        <SidebarContent className="min-h-0 overflow-hidden group-data-[collapsible=icon]:items-center">
          <div className="hidden flex-col items-center gap-2 py-3 group-data-[collapsible=icon]:flex">
            <button
              type="button"
              onClick={openNewThread}
              disabled={!activeProjectId}
              aria-label="New thread"
              title="New thread"
              className="inline-flex size-8 items-center justify-center rounded-sm text-sidebar-foreground/65 transition hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-30"
            >
              <Pencil className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onCreateProject}
              aria-label="Add project"
              title="Add project"
              className="inline-flex size-8 items-center justify-center rounded-sm text-sidebar-foreground/65 transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
            <div className="shrink-0 space-y-1.5 px-3 pt-3 pb-2">
              <div className="relative flex h-9 items-center rounded-[6px] transition focus-within:bg-sidebar-accent focus-within:ring-1 focus-within:ring-sidebar-ring/40">
                <Search className="pointer-events-none absolute left-2.5 size-4 text-sidebar-foreground/45" aria-hidden="true" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setSearchQuery("");
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="Search threads"
                  aria-label="Search threads in active project"
                  className="h-full min-w-0 flex-1 bg-transparent pr-14 pl-9 text-[13px] text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/45"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      searchInputRef.current?.focus();
                    }}
                    aria-label="Clear search"
                    className="absolute right-2 inline-flex size-5 items-center justify-center rounded-[4px] text-sidebar-foreground/35 transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                ) : (
                  <kbd className="pointer-events-none absolute right-2 rounded-[4px] bg-sidebar-accent px-1.5 py-0.5 font-mono text-[9px] text-sidebar-foreground/40">
                    ⌘K
                  </kbd>
                )}
              </div>

              <button
                type="button"
                onClick={openNewThread}
                disabled={!activeProjectId}
                className="flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left text-[13px] font-medium text-sidebar-foreground/75 transition hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring/50 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Pencil className="size-4 text-sidebar-foreground/45" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">New thread</span>
                {activeProjectName ? (
                  <span className="max-w-24 truncate font-mono text-[9px] uppercase tracking-[0.08em] text-sidebar-foreground/30">
                    {activeProjectName}
                  </span>
                ) : null}
              </button>
            </div>

            <div className="flex shrink-0 items-stretch border-y border-sidebar-border/80 bg-sidebar-accent/25 p-2 pr-1.5">
              <div
                role="tablist"
                aria-label="Projects"
                className="workspace-project-rail flex min-w-0 flex-1 gap-1.5 overflow-x-auto overscroll-x-contain pb-1"
              >
                {projects === undefined ? (
                  <div className="h-9 w-32 shrink-0 animate-pulse rounded-[5px] bg-sidebar-accent" />
                ) : projects.length === 0 ? (
                  <p className="flex h-9 items-center px-2 text-[11px] text-sidebar-foreground/40">No projects yet</p>
                ) : (
                  projects.map((project, index) => {
                    const { name } = projectParts(project.repoFullName);
                    const active = project.projectId === activeProjectId;
                    const markerClasses = [
                      "bg-[color:var(--framer-accent-blue)]",
                      "bg-[color:var(--framer-gradient-violet)]",
                      "bg-[color:var(--framer-gradient-orange)]",
                      "bg-[color:var(--framer-success)]",
                    ][index % 4];

                    return (
                      <Link
                        key={project.projectId}
                        ref={active ? activeProjectTabRef : undefined}
                        to="/project/$projectId"
                        params={{ projectId: project.projectId }}
                        role="tab"
                        aria-selected={active}
                        title={project.repoFullName}
                        className={cn(
                          "relative flex h-9 max-w-36 shrink-0 items-center gap-2 rounded-[5px] border px-2.5 text-[12px] font-medium transition focus-visible:ring-1 focus-visible:ring-sidebar-ring/60",
                          active
                            ? "border-sidebar-foreground/20 bg-sidebar text-sidebar-foreground"
                            : "border-sidebar-border bg-transparent text-sidebar-foreground/50 hover:border-sidebar-foreground/15 hover:bg-sidebar hover:text-sidebar-foreground/80",
                        )}
                      >
                        <span className={cn("grid size-5 shrink-0 place-items-center rounded-[4px] text-[9px] font-semibold uppercase text-white", markerClasses)}>
                          {name.slice(0, 2)}
                        </span>
                        <span className="truncate">{name}</span>
                        {active ? <span className="absolute inset-x-2 -bottom-[5px] h-0.5 bg-[color:var(--project-selected-strong)]" aria-hidden="true" /> : null}
                      </Link>
                    );
                  })
                )}
              </div>
              <button
                type="button"
                onClick={onCreateProject}
                aria-label="Add project"
                title="Add project"
                className="ml-1.5 inline-flex size-9 shrink-0 items-center justify-center rounded-[5px] border border-dashed border-sidebar-foreground/20 text-sidebar-foreground/45 transition hover:border-sidebar-foreground/35 hover:bg-sidebar hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring/60"
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex h-10 shrink-0 items-center gap-2 px-3">
                <p className="min-w-0 flex-1 truncate font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-sidebar-foreground/40">
                  {activeProjectName ? `${activeProjectName} threads` : "Threads"}
                </p>
                {visibleThreads ? (
                  <span className="font-mono text-[9px] tabular-nums text-sidebar-foreground/30">{visibleThreads.length}</span>
                ) : null}
                {activeProject ? (
                  <button
                    type="button"
                    onClick={() => onDeleteProject(activeProject.projectId)}
                    aria-label={`Delete project ${activeProject.repoFullName}`}
                    title="Delete project"
                    className="inline-flex size-6 items-center justify-center rounded-[4px] text-sidebar-foreground/25 transition hover:bg-destructive/10 hover:text-destructive focus-visible:ring-1 focus-visible:ring-sidebar-ring/50"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              <div className="minimal-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {visibleThreads === undefined && activeProjectId ? (
                  <div className="flex items-center gap-2 px-2 py-5 text-[12px] text-sidebar-foreground/40">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    Loading threads
                  </div>
                ) : !activeProjectId ? (
                  <div className="mx-1 border border-dashed border-sidebar-border px-3 py-6 text-center">
                    <p className="text-[12px] text-sidebar-foreground/45">Add a project to start a thread.</p>
                    <button type="button" onClick={onCreateProject} className="mt-3 text-[12px] font-medium text-sidebar-foreground/75 hover:text-sidebar-foreground">
                      Add project
                    </button>
                  </div>
                ) : visibleThreads?.length === 0 ? (
                  <div className="mx-1 border border-dashed border-sidebar-border px-3 py-6 text-center">
                    <p className="text-[12px] text-sidebar-foreground/45">
                      {normalizedSearch ? "No matching threads." : "No threads in this project yet."}
                    </p>
                    {!normalizedSearch ? (
                      <button type="button" onClick={openNewThread} className="mt-3 text-[12px] font-medium text-sidebar-foreground/75 hover:text-sidebar-foreground">
                        Start the first thread
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {visibleThreads?.map((thread) => {
                      const threadActive = thread.threadId === activeThreadId;
                      const age = formatAge(thread.updatedAt);

                      return (
                        <li key={thread.threadId} className="group/thread relative">
                          <Link
                            to="/project/$projectId/thread/$threadId"
                            params={{ projectId: activeProjectId, threadId: thread.threadId }}
                            className={cn(
                              "block min-h-[72px] rounded-[6px] border px-3 py-2.5 pr-9 transition",
                              threadActive
                                ? "border-sidebar-foreground/45 bg-sidebar-accent text-sidebar-foreground"
                                : "border-transparent text-sidebar-foreground/65 hover:border-sidebar-border hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                            )}
                          >
                            <span className="flex items-start gap-2">
                              <span className="min-w-0 flex-1 line-clamp-2 text-[13px] font-medium leading-[1.35]">
                                {thread.title ?? "Untitled thread"}
                              </span>
                              {thread.isLive ? (
                                <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin text-[color:var(--project-selected-strong)]" aria-label="Working" />
                              ) : age ? (
                                <span className="mt-px shrink-0 font-mono text-[9px] tabular-nums text-sidebar-foreground/35">{age}</span>
                              ) : null}
                            </span>
                            <span className="mt-2 flex items-center gap-1.5 font-mono text-[9px] text-sidebar-foreground/35">
                              <GitBranch className="size-3" aria-hidden="true" />
                              <span className="truncate">{activeBranch}</span>
                            </span>
                          </Link>
                          <button
                            type="button"
                            disabled={deletingThreadId === thread.threadId}
                            aria-label={`Delete thread ${thread.title ?? thread.threadId}`}
                            title="Delete thread"
                            onClick={(event) => handleDeleteThread(event, thread)}
                            className="absolute right-2 bottom-2 inline-flex size-6 items-center justify-center rounded-[4px] text-sidebar-foreground/25 opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover/thread:opacity-100 group-focus-within/thread:opacity-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {deletingThreadId === thread.threadId ? (
                              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                            ) : (
                              <Trash2 className="size-3" aria-hidden="true" />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border/70 p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <div className="flex h-9 items-center gap-2 px-2 group-data-[collapsible=icon]:justify-center">
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="inline-flex h-8 min-w-0 flex-1 items-center gap-2 text-left text-[13px] text-sidebar-foreground/70 transition hover:text-sidebar-foreground group-data-[collapsible=icon]:hidden"
                >
                  <Settings className="size-4 text-sidebar-foreground/55" aria-hidden="true" />
                  <span className="truncate">Settings</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="hidden size-8 items-center justify-center text-sidebar-foreground/70 transition hover:bg-[color:var(--project-selected)] hover:text-sidebar-foreground group-data-[collapsible=icon]:inline-flex"
                  aria-label="Settings"
                  title="Settings"
                >
                  <Settings className="size-4" aria-hidden="true" />
                </button>
                <ModeToggle className="size-8 text-sidebar-foreground/70 hover:bg-[color:var(--project-selected)] hover:text-sidebar-foreground group-data-[collapsible=icon]:hidden" />
                <WorkOSUserButton className="size-8 group-data-[collapsible=icon]:hidden" />
              </div>
            </SidebarMenuItem>
            <SidebarMenuItem className="hidden group-data-[collapsible=icon]:block">
              <div className="flex h-9 items-center justify-center">
                <ModeToggle className="size-8 text-sidebar-foreground/70 hover:bg-[color:var(--project-selected)] hover:text-sidebar-foreground" />
              </div>
            </SidebarMenuItem>
            <SidebarMenuItem className="hidden group-data-[collapsible=icon]:block">
              <div className="flex h-9 items-center justify-center">
                <WorkOSUserButton className="size-8" />
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <Dialog open={Boolean(pendingDeleteThread)} onOpenChange={(open) => !open && setPendingDeleteThread(undefined)}>
        <DialogContent className="max-w-[320px] gap-3 p-4" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-sm">Delete thread?</DialogTitle>
            <DialogDescription className="line-clamp-2 text-[12px]">
              {pendingDeleteThread?.title ?? pendingDeleteThread?.threadId}
            </DialogDescription>
          </DialogHeader>
          {deleteThreadError ? (
            <p className="text-xs text-destructive" role="alert">{deleteThreadError}</p>
          ) : null}
          <DialogFooter className="flex-row justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={Boolean(deletingThreadId)}
              onClick={() => setPendingDeleteThread(undefined)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={Boolean(deletingThreadId)}
              onClick={confirmDeleteThread}
            >
              {deletingThreadId ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function WorkspaceShell({
  activeProjectId,
  activeThreadId,
  activeProjectThreads,
  children,
}: {
  activeProjectId?: string;
  activeThreadId?: string;
  activeProjectThreads?: WorkspaceThread[] | undefined;
  children: ReactNode | ((props: { openCreateProject: () => void }) => ReactNode);
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const projects = useQuery(api.projects.list, isAuthenticated ? {} : "skip") as WorkspaceProject[] | undefined;
  const sandboxCosts = useQuery(
    api.sandboxCosts.listForCurrentUser,
    isAuthenticated ? {} : "skip",
  ) as WorkspaceSandboxCost[] | undefined;
  const userSettings = useQuery(
    api.userSettings.get,
    isAuthenticated ? {} : "skip",
  ) as WorkspaceUserSettings | undefined;
  const removeProjectWithSandbox = useAction(api.projectActions.removeWithSandbox);
  const setDemoRecordingExperimentEnabled = useConvexMutation(
    api.userSettings.setDemoRecordingExperimentEnabled,
  );
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [projectIdToDelete, setProjectIdToDelete] = useState<string | undefined>();
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const [userSettingsSaving, setUserSettingsSaving] = useState(false);
  const [userSettingsError, setUserSettingsError] = useState<string | undefined>();
  const openCreateProject = useCallback(() => {
    setIsCreateDialogOpen(true);
  }, []);

  const cachedThreads = activeProjectId ? sidebarThreadCache.get(activeProjectId) : undefined;
  const sidebarThreads = activeProjectThreads ?? cachedThreads;

  const codexStatusQuery = useCodexStatus(isAuthenticated);

  const projectToDelete = useMemo(
    () => projects?.find((p) => p.projectId === projectIdToDelete),
    [projectIdToDelete, projects],
  );

  useEffect(() => {
    if (activeProjectId && activeProjectThreads !== undefined) {
      sidebarThreadCache.set(activeProjectId, activeProjectThreads);
    }
  }, [activeProjectId, activeProjectThreads]);

  async function deleteProject() {
    if (!projectToDelete) return;

    setIsDeletingProject(true);
    setDeleteError(undefined);

    try {
      await removeProjectWithSandbox({ projectId: projectToDelete.projectId });
      setProjectIdToDelete(undefined);
      sidebarThreadCache.delete(projectToDelete.projectId);
      if (projectToDelete.projectId === activeProjectId) {
        navigate({ to: "/dashboard" });
      }
      router.invalidate();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete the project.");
    } finally {
      setIsDeletingProject(false);
    }
  }

  const updateDemoRecordingExperimentEnabled = useCallback(async (enabled: boolean) => {
    setUserSettingsSaving(true);
    setUserSettingsError(undefined);

    try {
      await setDemoRecordingExperimentEnabled({ enabled });
    } catch (err) {
      setUserSettingsError(err instanceof Error ? err.message : "Could not update settings.");
    } finally {
      setUserSettingsSaving(false);
    }
  }, [setDemoRecordingExperimentEnabled]);

  return (
    <TooltipProvider>
      <SidebarProvider
        className="project-shell h-dvh max-h-dvh overflow-hidden"
        style={{ "--sidebar-width": "18rem" } as CSSProperties}
      >
        <WorkspaceSidebar
          projects={projects}
          activeProjectId={activeProjectId}
          activeThreadId={activeThreadId}
          activeProjectThreads={sidebarThreads}
          onCreateProject={openCreateProject}
          onDeleteProject={(projectId) => setProjectIdToDelete(projectId)}
          onOpenSettings={() => setIsSettingsDialogOpen(true)}
        />
        <SidebarInset className="min-w-0 overflow-hidden">
          <div className="fixed left-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-40 md:hidden">
            <SidebarTrigger className="border border-border bg-background" />
          </div>
          <RouteTransition>
            {typeof children === "function"
              ? children({ openCreateProject })
              : children}
          </RouteTransition>
        </SidebarInset>

        <WorkspaceCreateSandboxDialog
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
        />
        <DeleteDialog
          open={Boolean(projectToDelete)}
          onOpenChange={(open) => {
            if (!open) {
              setProjectIdToDelete(undefined);
              setDeleteError(undefined);
            }
          }}
          projectName={projectToDelete?.repoFullName ?? "this project"}
          isDeleting={isDeletingProject}
          onDelete={deleteProject}
        />
        {deleteError ? (
          <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 border border-destructive/30 bg-popover px-3 py-2 text-xs text-destructive">
            {deleteError}
          </div>
        ) : null}
        <SettingsDialog
          open={isSettingsDialogOpen}
          projects={projects}
          sandboxCosts={sandboxCosts}
          userSettings={userSettings}
          userSettingsSaving={userSettingsSaving}
          userSettingsError={userSettingsError}
          onDemoRecordingExperimentEnabledChange={updateDemoRecordingExperimentEnabled}
          codexStatus={codexStatusQuery.data}
          onCodexStatusChange={() => void codexStatusQuery.refetch()}
          onOpenChange={setIsSettingsDialogOpen}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
}
