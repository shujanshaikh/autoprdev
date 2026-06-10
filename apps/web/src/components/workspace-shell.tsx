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
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarTrigger,
} from "@autopr/ui/components/sidebar";
import { TooltipProvider } from "@autopr/ui/components/tooltip";
import { cn } from "@autopr/ui/lib/utils";
import {
  Folder,
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
import { SettingsDialog } from "#/components/settings/settings-dialog";
import { CreateSandboxPanel } from "#/components/dashboard/create-sandbox-panel";
import { DeleteDialog } from "#/components/dashboard/delete-dialog";
import { ModeToggle } from "#/components/mode-toggle";
import {
  readJson,
  statusStyles,
  type GithubBranch,
  type GithubRepository,
  type SandboxRuntimeStatus,
  type SandboxStatus,
} from "#/components/dashboard/types";
import { RouteTransition } from "#/components/route-transition";

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
  const [selectedRepoFullName, setSelectedRepoFullName] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
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

  useEffect(() => {
    if (!repositories.length) {
      setSelectedRepoFullName("");
      return;
    }

    if (
      !selectedRepoFullName ||
      !repositories.some((repo) => repo.fullName === selectedRepoFullName)
    ) {
      setSelectedRepoFullName(repositories[0].fullName);
    }
  }, [repositories, selectedRepoFullName]);

  useEffect(() => {
    if (!selectedRepo) {
      setSelectedBranch("");
      return;
    }

    if (!branches.length) {
      setSelectedBranch("");
      return;
    }

    setSelectedBranch(
      branches.some((branch) => branch.name === selectedRepo.defaultBranch)
        ? selectedRepo.defaultBranch
        : branches[0]?.name ?? "",
    );
  }, [branches, selectedRepo]);

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
            onRepoChange={setSelectedRepoFullName}
            onBranchChange={setSelectedBranch}
            onCreate={() => createProjectMutation.mutate()}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProjectSummaryRow({ project }: { project: WorkspaceProject }) {
  const { owner, name } = projectParts(project.repoFullName);
  const branch = project.currentBranch ?? project.repoBranch ?? project.defaultBranch ?? "main";
  const styles = statusStyles(project.sandboxStatus);

  return (
    <Link
      to="/project/$projectId"
      params={{ projectId: project.projectId }}
      className="group grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 px-3 py-2 transition last:border-b-0 hover:bg-muted/45 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,0.9fr)_7rem]"
    >
      <div className="min-w-0">
        <p className="truncate text-[13px]">
          {owner ? (
            <>
              <span className="text-muted-foreground">{owner}</span>
              <span className="text-muted-foreground/45">/</span>
            </>
          ) : null}
          <span className="font-semibold text-foreground group-hover:underline group-hover:underline-offset-4">
            {name}
          </span>
        </p>
        <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60 sm:hidden">
          {branch}
        </p>
      </div>
      <div className="hidden min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground sm:flex">
        <GitBranch className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{branch}</span>
      </div>
      <div className="flex items-center justify-end gap-2">
        <span className={cn("font-mono text-[10px] uppercase tracking-[0.16em]", styles.label)}>
          {project.sandboxStatus}
        </span>
        <span className="hidden font-mono text-[10px] tabular-nums text-muted-foreground/55 sm:inline">
          {formatAge(project.lastOpenedAt ?? project.updatedAt)}
        </span>
      </div>
    </Link>
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
  const removeThread = useConvexMutation(api.threads.remove);
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingThreadId, setDeletingThreadId] = useState<string | undefined>();
  const [pendingDeleteThread, setPendingDeleteThread] = useState<WorkspaceThread | undefined>();
  const [expandedProjectId, setExpandedProjectId] = useState<string | undefined>(activeProjectId);
  const [showAllThreadsProjectIds, setShowAllThreadsProjectIds] = useState<Set<string>>(() => new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const expandedProjectThreads = useQuery(
    api.threads.listByProject,
    expandedProjectId && expandedProjectId !== activeProjectId
      ? { projectId: expandedProjectId }
      : "skip",
  );

  useEffect(() => {
    if (activeProjectId) {
      setExpandedProjectId(activeProjectId);
    }
  }, [activeProjectId]);

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

  const filteredProjects = useMemo(() => {
    if (!projects) return undefined;
    if (!normalizedSearch) return projects;
    return projects.filter((project) => {
      if (project.projectId === activeProjectId) return true;
      return project.repoFullName.toLowerCase().includes(normalizedSearch);
    });
  }, [activeProjectId, normalizedSearch, projects]);

  const SIDEBAR_MAX_THREADS = 6;

  const getSidebarThreads = useCallback((projectId: string, sourceThreads: WorkspaceThread[] | undefined) => {
    if (!sourceThreads) return { visibleThreads: undefined, hiddenThreadCount: 0 };
    const threads = normalizedSearch
      ? sourceThreads.filter((thread) =>
        `${thread.title ?? ""} ${thread.threadId}`.toLowerCase().includes(normalizedSearch),
      )
      : sourceThreads;
    const hiddenThreadCount = Math.max(threads.length - SIDEBAR_MAX_THREADS, 0);
    const visibleThreads = showAllThreadsProjectIds.has(projectId)
      ? threads
      : threads.slice(0, SIDEBAR_MAX_THREADS);

    return { visibleThreads, hiddenThreadCount };
  }, [normalizedSearch, showAllThreadsProjectIds]);

  function showAllProjectThreads(projectId: string) {
    setShowAllThreadsProjectIds((current) => {
      const next = new Set(current);
      next.add(projectId);
      return next;
    });
  }

  function handleProjectNewChat(event: MouseEvent<HTMLButtonElement>, projectId: string) {
    event.preventDefault();
    event.stopPropagation();
    setExpandedProjectId(projectId);
    navigate({ to: "/project/$projectId", params: { projectId } });
  }

  function handleDeleteThread(event: MouseEvent<HTMLButtonElement>, thread: WorkspaceThread) {
    event.preventDefault();
    event.stopPropagation();
    setPendingDeleteThread(thread);
  }

  async function confirmDeleteThread() {
    if (!pendingDeleteThread) return;

    const thread = pendingDeleteThread;
    setDeletingThreadId(thread.threadId);
    try {
      await removeThread({ threadId: thread.threadId });
      setPendingDeleteThread(undefined);
      if (thread.threadId === activeThreadId && activeProjectId) {
        navigate({ to: "/project/$projectId", params: { projectId: activeProjectId } });
      }
      router.invalidate();
    } finally {
      setDeletingThreadId(undefined);
    }
  }

  return (
    <>
      <Sidebar collapsible="icon" variant="sidebar">
        <SidebarHeader className="h-11 shrink-0 justify-center gap-0 border-b border-sidebar-border/70 px-2.5 py-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <SidebarTrigger className="text-sidebar-foreground/70 hover:text-sidebar-foreground" />
          </div>
        </SidebarHeader>

        <SidebarContent className="minimal-scrollbar">
          <SidebarGroup className="min-h-0 flex-1 px-2 py-2">
            <div className="mb-2 px-2 group-data-[collapsible=icon]:hidden">
              <button
                type="button"
                onClick={onCreateProject}
                className="inline-flex h-9 w-full items-center gap-2 border border-sidebar-border bg-sidebar px-2 text-left text-[12px] font-medium text-sidebar-foreground/75 transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <Plus className="size-4 text-sidebar-foreground/50" aria-hidden="true" />
                <span className="truncate">New project</span>
              </button>
            </div>

            <div className="mb-3 px-2 group-data-[collapsible=icon]:hidden">
              <div className="relative flex h-8 items-center border border-sidebar-border bg-sidebar transition focus-within:border-sidebar-foreground/45">
                <Search
                  className="pointer-events-none absolute left-2 size-3.5 text-sidebar-foreground/40"
                  aria-hidden="true"
                />
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
                  placeholder="search projects…"
                  aria-label="Search projects"
                  className="h-full min-w-0 flex-1 bg-transparent pr-8 pl-8 text-[12px] text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/40"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      searchInputRef.current?.focus();
                    }}
                    aria-label="Clear search"
                    className="absolute right-2 inline-flex size-4 items-center justify-center text-sidebar-foreground/35 transition hover:text-sidebar-foreground/70"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>

            <SidebarGroupContent>
              <SidebarMenu className="gap-0">
                {filteredProjects === undefined ? (
                  <>
                    <SidebarMenuSkeleton showIcon />
                    <SidebarMenuSkeleton showIcon />
                    <SidebarMenuSkeleton showIcon />
                  </>
                ) : filteredProjects.length === 0 ? (
                  <div className="px-2 py-6 text-center group-data-[collapsible=icon]:hidden">
                    <p className="text-[12px] text-sidebar-foreground/45">No projects</p>
                    <button
                      type="button"
                      onClick={onCreateProject}
                      className="mt-3 inline-flex h-8 items-center gap-2 border border-sidebar-border px-3 text-[12px] font-medium text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                      Create project
                    </button>
                  </div>
                ) : (
                  filteredProjects.map((project) => {
                    const active = project.projectId === activeProjectId;
                    const expanded = project.projectId === expandedProjectId;
                    const projectThreads =
                      active ? activeProjectThreads : expanded ? expandedProjectThreads : undefined;
                    const { visibleThreads, hiddenThreadCount } = getSidebarThreads(project.projectId, projectThreads);
                    const { name } = projectParts(project.repoFullName);
                    return (
                      <SidebarMenuItem key={project.projectId} className="mb-1">
                        {/* ── Folder row ── */}
                        <SidebarMenuButton
                          render={<Link to="/project/$projectId" params={{ projectId: project.projectId }} />}
                          tooltip={project.repoFullName}
                          onClick={() => setExpandedProjectId(project.projectId)}
                          className={cn(
                            "group/project h-8 items-center gap-2 px-2 py-1 pr-12",
                            active
                              ? "bg-transparent text-sidebar-foreground hover:bg-transparent"
                              : "text-sidebar-foreground/55 hover:text-sidebar-foreground",
                          )}
                        >
                          <Folder
                            className={cn(
                              "size-[15px] shrink-0",
                              active ? "text-sidebar-foreground/70" : "text-sidebar-foreground/35",
                            )}
                            aria-hidden="true"
                          />
                          <span className={cn(
                            "min-w-0 flex-1 truncate text-[13px] leading-none group-data-[collapsible=icon]:hidden",
                            active ? "font-semibold text-sidebar-foreground" : "font-medium",
                          )}>
                            {name}
                          </span>
                        </SidebarMenuButton>
                        <SidebarMenuAction
                          type="button"
                          showOnHover
                          aria-label={`New chat for ${project.repoFullName}`}
                          title="New chat"
                          onClick={(event) => {
                            handleProjectNewChat(event, project.projectId);
                          }}
                          className="right-6 text-sidebar-foreground/30 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        >
                          <Pencil aria-hidden="true" />
                        </SidebarMenuAction>
                        <SidebarMenuAction
                          type="button"
                          showOnHover
                          aria-label={`Delete ${project.repoFullName}`}
                          title="Delete project"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onDeleteProject(project.projectId);
                          }}
                          className="text-sidebar-foreground/25 hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 aria-hidden="true" />
                        </SidebarMenuAction>

                        {/* ── Thread list ── */}
                        {expanded ? (
                          <div className="group-data-[collapsible=icon]:hidden">
                            {visibleThreads === undefined ? (
                              <div className="flex items-center py-3 pl-8">
                                <Loader2
                                  className="size-3.5 animate-spin text-sidebar-foreground/25"
                                  aria-hidden="true"
                                />
                              </div>
                            ) : visibleThreads.length === 0 ? null : (
                              <>
                                <ul className="py-0.5">
                                  {visibleThreads.map((thread) => {
                                    const threadActive = thread.threadId === activeThreadId;
                                    const age = formatAge(thread.updatedAt);
                                    return (
                                      <li key={thread.threadId} className="group/thread relative">
                                        <Link
                                          to="/project/$projectId/thread/$threadId"
                                          params={{ projectId: project.projectId, threadId: thread.threadId }}
                                          className={cn(
                                            "flex min-w-0 items-center gap-2 py-1.5 pr-8 pl-8 text-[13px] leading-snug transition-colors",
                                            threadActive
                                              ? "bg-sidebar-accent font-medium text-sidebar-foreground"
                                              : "text-sidebar-foreground/55 hover:text-sidebar-foreground",
                                          )}
                                        >
                                          <span className="min-w-0 flex-1 truncate">
                                            {thread.title ?? "Untitled Conversation"}
                                          </span>
                                          {thread.isLive ? (
                                            <Loader2 className="size-3 shrink-0 animate-spin text-sidebar-foreground/40" aria-label="Working" />
                                          ) : age ? (
                                            <span className="shrink-0 text-[12px] text-sidebar-foreground/30">
                                              {age}
                                            </span>
                                          ) : null}
                                        </Link>
                                        <button
                                          type="button"
                                          disabled={deletingThreadId === thread.threadId}
                                          aria-label={`Delete thread ${thread.title ?? thread.threadId}`}
                                          title="Delete thread"
                                          onClick={(event) => handleDeleteThread(event, thread)}
                                          className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex size-5 items-center justify-center text-sidebar-foreground/25 opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover/thread:opacity-100 group-focus-within/thread:opacity-100 disabled:cursor-not-allowed disabled:opacity-60"
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
                                {hiddenThreadCount > 0 && !showAllThreadsProjectIds.has(project.projectId) ? (
                                  <button
                                    type="button"
                                    onClick={() => showAllProjectThreads(project.projectId)}
                                    className="block py-1.5 pl-8 text-[13px] text-sidebar-foreground/35 transition-colors hover:text-sidebar-foreground/55"
                                  >
                                    See all ({hiddenThreadCount})
                                  </button>
                                ) : null}
                              </>
                            )}
                          </div>
                        ) : null}
                      </SidebarMenuItem>
                    );
                  })
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
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
                  className="hidden size-8 items-center justify-center text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-foreground group-data-[collapsible=icon]:inline-flex"
                  aria-label="Settings"
                  title="Settings"
                >
                  <Settings className="size-4" aria-hidden="true" />
                </button>
                <ModeToggle className="size-8 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground group-data-[collapsible=icon]:hidden" />
                <WorkOSUserButton className="size-8 group-data-[collapsible=icon]:hidden" />
              </div>
            </SidebarMenuItem>
            <SidebarMenuItem className="hidden group-data-[collapsible=icon]:block">
              <div className="flex h-9 items-center justify-center">
                <ModeToggle className="size-8 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
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
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const projects = useQuery(api.projects.list, isAuthenticated ? {} : "skip") as WorkspaceProject[] | undefined;
  const sandboxCosts = useQuery(
    api.sandboxCosts.listForCurrentUser,
    isAuthenticated ? {} : "skip",
  ) as WorkspaceSandboxCost[] | undefined;
  const removeProjectWithSandbox = useAction(api.projectActions.removeWithSandbox);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [projectIdToDelete, setProjectIdToDelete] = useState<string | undefined>();
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>();

  const cachedThreads = activeProjectId ? sidebarThreadCache.get(activeProjectId) : undefined;
  const sidebarThreads = activeProjectThreads ?? cachedThreads;

  const codexStatusQuery = useReactQuery({
    queryKey: ["codex", "status"],
    enabled: isAuthenticated,
    retry: false,
    queryFn: async () =>
      readJson<{
        connected: boolean;
        email?: string;
        accountId?: string;
      }>(await fetch("/api/codex/status")),
  });

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
          onCreateProject={() => setIsCreateDialogOpen(true)}
          onDeleteProject={(projectId) => setProjectIdToDelete(projectId)}
          onOpenSettings={() => setIsSettingsDialogOpen(true)}
        />
        <SidebarInset className="min-w-0 overflow-hidden">
          <div className="fixed left-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-40 md:hidden">
            <SidebarTrigger className="border border-border bg-background/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80" />
          </div>
          <RouteTransition>{children}</RouteTransition>
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
          <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 border border-destructive/30 bg-popover px-3 py-2 text-xs text-destructive shadow-lg">
            {deleteError}
          </div>
        ) : null}
        <SettingsDialog
          open={isSettingsDialogOpen}
          projects={projects}
          sandboxCosts={sandboxCosts}
          codexStatus={codexStatusQuery.data}
          onCodexStatusChange={() => void codexStatusQuery.refetch()}
          onOpenChange={setIsSettingsDialogOpen}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
}
