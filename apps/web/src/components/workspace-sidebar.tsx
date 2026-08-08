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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@autopr/ui/components/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@autopr/ui/components/sidebar";
import { cn } from "@autopr/ui/lib/utils";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
  Check,
  ChevronsUpDown,
  CircleAlert,
  Folder,
  FolderPlus,
  GitBranch,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useEffectEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { WorkOSUserButton } from "#/components/auth/workos-user-button";
import { ModeToggle } from "#/components/mode-toggle";
import { deleteThreadWithCleanup } from "#/lib/delete-thread";
import {
  partitionSidebarThreads,
  resolveNewThreadProjectId,
  SETTLED_INITIAL_COUNT,
  SETTLED_PAGE_COUNT,
  type SidebarThreadRecord,
} from "#/lib/workspace-sidebar";

export interface WorkspaceThread extends SidebarThreadRecord {
  isLive?: boolean;
  featureBranch?: string;
  pullRequestNumber?: number;
  agentRunIssue?: { message: string };
  workflowIssue?: { message: string };
}

export interface WorkspaceProject {
  projectId: string;
  repoFullName: string;
  sandboxStatus: "creating" | "ready" | "failed";
  sandboxRuntimeStatus?: "started" | "stopped" | "archived" | "unknown" | null;
  currentBranch?: string | null;
  repoBranch?: string | null;
  defaultBranch?: string | null;
  lastOpenedAt?: number;
  createdAt: number;
  updatedAt: number;
}

function projectName(repoFullName: string) {
  const parts = repoFullName.split("/");
  return parts.at(-1) || repoFullName;
}

const PROJECT_MARKER_CLASSES = [
  "bg-[color:var(--framer-accent-blue)]",
  "bg-[color:var(--framer-gradient-violet)]",
  "bg-[color:var(--framer-gradient-orange)]",
  "bg-[color:var(--framer-success)]",
];

function ProjectMarker({ index, repoFullName }: { index: number; repoFullName: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-[4px] text-[9px] font-semibold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]",
        PROJECT_MARKER_CLASSES[index % PROJECT_MARKER_CLASSES.length],
      )}
    >
      {projectName(repoFullName).slice(0, 2)}
    </span>
  );
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
  return `${Math.floor(days / 30)}mo`;
}

function ThreadRow({
  thread,
  project,
  active,
  settled,
  shortcut,
  isRenaming,
  renamingTitle,
  onRenamingTitleChange,
  onActivate,
  onRename,
  onCancelRename,
  onCommitRename,
  onSettle,
  onDelete,
}: {
  thread: WorkspaceThread;
  project: WorkspaceProject | undefined;
  active: boolean;
  settled: boolean;
  shortcut: string | undefined;
  isRenaming: boolean;
  renamingTitle: string;
  onRenamingTitleChange: (title: string) => void;
  onActivate: () => void;
  onRename: () => void;
  onCancelRename: () => void;
  onCommitRename: () => void;
  onSettle: (settled: boolean) => void;
  onDelete: () => void;
}) {
  const renameCommittedRef = useRef(false);
  const failed = Boolean(thread.agentRunIssue || thread.workflowIssue);
  const branch = thread.featureBranch
    ?? project?.currentBranch
    ?? project?.repoBranch
    ?? project?.defaultBranch
    ?? "main";

  useEffect(() => {
    if (isRenaming) renameCommittedRef.current = false;
  }, [isRenaming]);

  const handleRenameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      renameCommittedRef.current = true;
      onCommitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      renameCommittedRef.current = true;
      onCancelRename();
    }
  };

  const title = isRenaming ? (
    <input
      autoFocus
      value={renamingTitle}
      aria-label="Thread title"
      onChange={(event) => onRenamingTitleChange(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={handleRenameKeyDown}
      onBlur={() => {
        if (!renameCommittedRef.current) onCommitRename();
      }}
      onClick={(event) => event.stopPropagation()}
      className="pointer-events-auto min-w-0 flex-1 rounded-[4px] border border-sidebar-border bg-sidebar px-1.5 py-0.5 text-[13px] text-sidebar-foreground outline-none focus:border-sidebar-foreground/40"
    />
  ) : (
    <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-[1.35]">
      {thread.title ?? "Untitled thread"}
    </span>
  );

  const handleDoubleClick = (event: ReactMouseEvent) => {
    if ((event.target as HTMLElement).closest("button, input")) return;
    event.preventDefault();
    onRename();
  };

  const actions = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Actions for ${thread.title ?? "thread"}`}
            onClick={(event) => event.stopPropagation()}
            className="pointer-events-auto inline-flex size-6 shrink-0 items-center justify-center rounded-[4px] text-sidebar-foreground/30 opacity-0 transition hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:opacity-100 group-hover/thread:opacity-100 group-focus-within/thread:opacity-100"
          />
        }
      >
        <MoreHorizontal className="size-3.5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="right" className="w-40">
        <DropdownMenuItem onClick={() => onSettle(!settled)}>
          {settled ? <RotateCcw /> : <Check />}
          {settled ? "Un-settle" : "Settle"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onRename}>
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (settled) {
    return (
      <li className="group/thread relative list-none">
        <div
          className={cn(
            "relative flex h-9 items-center gap-2 rounded-[6px] px-2.5 text-sidebar-foreground/45 transition hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            active && "bg-sidebar-accent text-sidebar-foreground",
          )}
        >
          <button
            type="button"
            aria-label={`Open thread ${thread.title ?? thread.threadId}`}
            onClick={onActivate}
            onDoubleClick={handleDoubleClick}
            className="absolute inset-0 z-0 cursor-pointer rounded-[6px] outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring/50"
          />
          <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-2">
            <MessageSquare className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
            {title}
            {thread.pullRequestNumber ? (
              <span className="shrink-0 font-mono text-[9px] text-sidebar-foreground/35">
                #{thread.pullRequestNumber}
              </span>
            ) : null}
            <span className="ml-auto shrink-0 font-mono text-[9px] tabular-nums text-sidebar-foreground/30 group-hover/thread:hidden">
              {shortcut ?? formatAge(thread.updatedAt)}
            </span>
            {actions}
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="group/thread relative list-none">
      <div
        className={cn(
          "relative min-h-[76px] rounded-[6px] border px-3 py-2.5 text-sidebar-foreground/65 transition",
          active
            ? "border-sidebar-foreground/45 bg-sidebar-accent text-sidebar-foreground"
            : "border-transparent hover:border-sidebar-border hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        )}
      >
        <button
          type="button"
          aria-label={`Open thread ${thread.title ?? thread.threadId}`}
          onClick={onActivate}
          onDoubleClick={handleDoubleClick}
          className="absolute inset-0 z-0 cursor-pointer rounded-[6px] outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring/50"
        />
        <div className="pointer-events-none relative z-10 flex min-w-0 items-center gap-2">
          <Folder className="size-3.5 shrink-0 text-sidebar-foreground/40" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-mono text-[9px] uppercase tracking-[0.08em] text-sidebar-foreground/40">
            {project ? projectName(project.repoFullName) : "Project"}
          </span>
          {shortcut ? (
            <kbd className="shrink-0 rounded-[3px] bg-sidebar-accent px-1 py-px font-mono text-[8px] text-sidebar-foreground/45">
              {shortcut}
            </kbd>
          ) : thread.isLive ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-sidebar-foreground/65">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              Working
            </span>
          ) : failed ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-destructive">
              <CircleAlert className="size-3" aria-hidden="true" />
              Failed
            </span>
          ) : (
            <span className="shrink-0 font-mono text-[9px] tabular-nums text-sidebar-foreground/30">
              {formatAge(thread.updatedAt)}
            </span>
          )}
        </div>
        <div className="pointer-events-none relative z-10 mt-1 flex min-w-0 items-center gap-1.5">
          {title}
          {actions}
        </div>
        <div className="pointer-events-none relative z-10 mt-1.5 flex min-w-0 items-center gap-1.5 font-mono text-[9px] text-sidebar-foreground/35">
          <GitBranch className="size-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{branch}</span>
          {thread.pullRequestNumber ? <span>#{thread.pullRequestNumber}</span> : null}
        </div>
      </div>
    </li>
  );
}

export function WorkspaceSidebar({
  projects,
  threads,
  activeProjectId,
  activeThreadId,
  onCreateProject,
  onDeleteProject,
  onOpenSettings,
}: {
  projects: WorkspaceProject[] | undefined;
  threads: WorkspaceThread[] | undefined;
  activeProjectId?: string;
  activeThreadId?: string;
  onCreateProject: () => void;
  onDeleteProject: (projectId: string) => void;
  onOpenSettings: () => void;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const updateTitle = useMutation(api.threads.updateTitle);
  const setSettlement = useMutation(api.threads.setSettlement);
  const [requestedProjectScopeId, setRequestedProjectScopeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [settledVisibleCount, setSettledVisibleCount] = useState(SETTLED_INITIAL_COUNT);
  const [showJumpHints, setShowJumpHints] = useState(false);
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [pendingDeleteThread, setPendingDeleteThread] = useState<WorkspaceThread | null>(null);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [nowMinute, setNowMinute] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);

  const projectsById = useMemo(
    () => new Map((projects ?? []).map((project) => [project.projectId, project] as const)),
    [projects],
  );
  const projectScopeId = requestedProjectScopeId && projectsById.has(requestedProjectScopeId)
    ? requestedProjectScopeId
    : null;
  const orderedProjects = useMemo(() => {
    if (!projects) return undefined;
    const activityByProject = new Map<string, number>();
    for (const thread of threads ?? []) {
      activityByProject.set(
        thread.projectId,
        Math.max(activityByProject.get(thread.projectId) ?? 0, thread.updatedAt),
      );
    }
    return [...projects].sort((left, right) => {
      const rightActivity = activityByProject.get(right.projectId)
        ?? right.lastOpenedAt
        ?? right.updatedAt;
      const leftActivity = activityByProject.get(left.projectId)
        ?? left.lastOpenedAt
        ?? left.updatedAt;
      return rightActivity - leftActivity || left.repoFullName.localeCompare(right.repoFullName);
    });
  }, [projects, threads]);
  const scopedProject = projectScopeId ? projectsById.get(projectScopeId) : undefined;
  const scopedProjectIndex = scopedProject
    ? Math.max(0, orderedProjects?.findIndex((project) => project.projectId === scopedProject.projectId) ?? 0)
    : 0;
  const { active, settled } = useMemo(
    () => partitionSidebarThreads(threads ?? [], {
      projectId: projectScopeId,
      search: searchQuery,
      now: nowMinute,
    }),
    [nowMinute, projectScopeId, searchQuery, threads],
  );
  const visibleSettled = useMemo(
    () => settled.slice(0, settledVisibleCount),
    [settled, settledVisibleCount],
  );
  const hiddenSettledCount = Math.max(0, settled.length - visibleSettled.length);
  const visibleThreads = useMemo(
    () => [...active, ...visibleSettled],
    [active, visibleSettled],
  );

  useEffect(() => {
    const interval = window.setInterval(
      () => setNowMinute(Math.floor(Date.now() / 60_000) * 60_000),
      60_000,
    );
    return () => window.clearInterval(interval);
  }, []);

  const activateThread = useCallback((thread: WorkspaceThread) => {
    if (isMobile) setOpenMobile(false);
    navigate({
      to: "/project/$projectId/thread/$threadId",
      params: { projectId: thread.projectId, threadId: thread.threadId },
    });
  }, [isMobile, navigate, setOpenMobile]);

  const handleGlobalKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === "k") {
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
      return;
    }
    if (modifier) setShowJumpHints(true);
    if (!modifier || event.altKey || event.shiftKey) return;
    const index = Number(event.key) - 1;
    if (!Number.isInteger(index) || index < 0 || index > 8) return;
    const thread = visibleThreads[index];
    if (!thread) return;
    event.preventDefault();
    activateThread(thread);
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      handleGlobalKeyDown(event);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Meta" || event.key === "Control") setShowJumpHints(false);
    };
    const handleBlur = () => setShowJumpHints(false);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const openNewThread = (projectId?: string) => {
    const resolvedProjectId = projectId ?? resolveNewThreadProjectId(orderedProjects ?? [], {
      activeProjectId,
      scopedProjectId: projectScopeId,
    });
    if (!resolvedProjectId) return;
    if (isMobile) setOpenMobile(false);
    navigate({ to: "/project/$projectId", params: { projectId: resolvedProjectId } });
  };

  const commitRename = async (thread: WorkspaceThread) => {
    const title = renamingTitle.trim();
    setRenamingThreadId(null);
    if (!title || title === thread.title) return;
    setActionError(null);
    try {
      await updateTitle({ threadId: thread.threadId, title });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not rename the thread.");
    }
  };

  const updateSettlement = async (thread: WorkspaceThread, settledValue: boolean) => {
    setActionError(null);
    try {
      await setSettlement({ threadId: thread.threadId, settled: settledValue });
      if (settledValue && thread.threadId === activeThreadId) {
        const next = active.find((candidate) => candidate.threadId !== thread.threadId);
        if (next) {
          activateThread(next);
        } else {
          navigate({ to: "/project/$projectId", params: { projectId: thread.projectId } });
        }
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not update the thread.");
    }
  };

  const confirmDeleteThread = async () => {
    if (!pendingDeleteThread) return;
    const thread = pendingDeleteThread;
    setDeletingThreadId(thread.threadId);
    setActionError(null);
    try {
      await deleteThreadWithCleanup(thread.projectId, thread.threadId);
      setPendingDeleteThread(null);
      if (thread.threadId === activeThreadId) {
        navigate({ to: "/project/$projectId", params: { projectId: thread.projectId } });
      }
      router.invalidate();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not delete the thread.");
    } finally {
      setDeletingThreadId(null);
    }
  };

  const newThreadButton = (
    <button
      type="button"
      onClick={orderedProjects?.length === 1 ? () => openNewThread(orderedProjects[0]?.projectId) : undefined}
      disabled={!orderedProjects?.length}
      className="flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left text-[13px] font-medium text-sidebar-foreground/75 transition hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring/50 disabled:cursor-not-allowed disabled:opacity-35"
    >
      <Pencil className="size-4 text-sidebar-foreground/45" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">New thread</span>
      {scopedProject ? (
        <span className="max-w-24 truncate font-mono text-[9px] uppercase tracking-[0.08em] text-sidebar-foreground/30">
          {projectName(scopedProject.repoFullName)}
        </span>
      ) : null}
    </button>
  );

  return (
    <>
      <Sidebar collapsible="icon" variant="sidebar">
        <SidebarHeader className="h-12 shrink-0 justify-center gap-0 border-b border-sidebar-border/80 px-3 py-0">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger className="text-sidebar-foreground/70 hover:text-sidebar-foreground" />
            <span className="min-w-0 truncate font-display text-base font-medium tracking-[-0.02em] text-sidebar-foreground group-data-[collapsible=icon]:hidden">
              AUTOPR
            </span>
          </div>
        </SidebarHeader>

        <SidebarContent className="min-h-0 overflow-hidden group-data-[collapsible=icon]:items-center">
          <div className="hidden flex-col items-center gap-2 py-3 group-data-[collapsible=icon]:flex">
            <button
              type="button"
              onClick={() => openNewThread()}
              disabled={!orderedProjects?.length}
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
              <FolderPlus className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
            <div className="shrink-0 space-y-1.5 px-3 pb-2 pt-3">
              <div className="relative flex h-9 items-center rounded-[6px] transition focus-within:bg-sidebar-accent focus-within:ring-1 focus-within:ring-sidebar-ring/40">
                <Search className="pointer-events-none absolute left-2.5 size-4 text-sidebar-foreground/45" aria-hidden="true" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setSettledVisibleCount(SETTLED_INITIAL_COUNT);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setSearchQuery("");
                      setSettledVisibleCount(SETTLED_INITIAL_COUNT);
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="Search"
                  aria-label="Search threads"
                  className="h-full min-w-0 flex-1 bg-transparent pl-9 pr-14 text-[13px] text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/45"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setSettledVisibleCount(SETTLED_INITIAL_COUNT);
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

              {(orderedProjects?.length ?? 0) > 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger render={newThreadButton} />
                  <DropdownMenuContent align="start" className="w-64">
                    {orderedProjects?.map((project) => (
                      <DropdownMenuItem key={project.projectId} onClick={() => openNewThread(project.projectId)}>
                        <Folder />
                        <span className="min-w-0 truncate">{projectName(project.repoFullName)}</span>
                        <span className="ml-auto truncate font-mono text-[9px] text-muted-foreground">
                          {project.repoFullName.split("/")[0]}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : newThreadButton}
            </div>

            <div className="flex shrink-0 items-center gap-1.5 border-y border-sidebar-border/70 bg-sidebar-accent/20 px-2.5 py-2">
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Select project"
                  className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[6px] border border-sidebar-foreground/15 bg-sidebar px-2.5 text-[12px] font-medium text-sidebar-foreground shadow-sm transition-colors hover:border-sidebar-foreground/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring/60 data-popup-open:border-sidebar-foreground/30"
                >
                  {scopedProject ? (
                    <ProjectMarker index={scopedProjectIndex} repoFullName={scopedProject.repoFullName} />
                  ) : (
                    <span className="grid size-5 shrink-0 place-items-center rounded-[4px] bg-sidebar-accent text-sidebar-foreground/55">
                      <Folder className="size-3" aria-hidden="true" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-left">
                    {scopedProject ? projectName(scopedProject.repoFullName) : "All projects"}
                  </span>
                  <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-foreground/40" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-(--anchor-width) min-w-56">
                  <DropdownMenuItem
                    onClick={() => {
                      setRequestedProjectScopeId(null);
                      setSettledVisibleCount(SETTLED_INITIAL_COUNT);
                    }}
                  >
                    <span className="grid size-5 shrink-0 place-items-center rounded-[4px] bg-sidebar-accent text-sidebar-foreground/55">
                      <Folder className="size-3" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">All projects</span>
                    {projectScopeId === null ? (
                      <Check className="ml-auto size-3.5 text-muted-foreground" aria-hidden="true" />
                    ) : null}
                  </DropdownMenuItem>
                  {(orderedProjects?.length ?? 0) > 0 ? <DropdownMenuSeparator /> : null}
                  {orderedProjects?.map((project, index) => {
                    const selected = project.projectId === projectScopeId;
                    return (
                      <DropdownMenuItem
                        key={project.projectId}
                        title={project.repoFullName}
                        onClick={() => {
                          setRequestedProjectScopeId(project.projectId);
                          setSettledVisibleCount(SETTLED_INITIAL_COUNT);
                        }}
                      >
                        <ProjectMarker index={index} repoFullName={project.repoFullName} />
                        <span className="min-w-0 flex-1 truncate">{projectName(project.repoFullName)}</span>
                        <span className="truncate font-mono text-[9px] text-muted-foreground">
                          {project.repoFullName.split("/")[0]}
                        </span>
                        {selected ? (
                          <Check className="ml-auto size-3.5 text-muted-foreground" aria-hidden="true" />
                        ) : null}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                type="button"
                onClick={onCreateProject}
                aria-label="Add project"
                title="Add project"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-[6px] border border-dashed border-sidebar-foreground/20 text-sidebar-foreground/45 transition-colors hover:border-sidebar-foreground/40 hover:bg-sidebar hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring/60"
              >
                <FolderPlus className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex h-10 shrink-0 items-center gap-2 px-3">
              <p className="min-w-0 flex-1 truncate font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-sidebar-foreground/40">
                {scopedProject ? `${projectName(scopedProject.repoFullName)} threads` : "All threads"}
              </p>
              {threads !== undefined ? (
                <span className="font-mono text-[9px] tabular-nums text-sidebar-foreground/30">
                  {active.length + settled.length}
                </span>
              ) : null}
              {scopedProject ? (
                <button
                  type="button"
                  onClick={() => onDeleteProject(scopedProject.projectId)}
                  aria-label={`Delete project ${scopedProject.repoFullName}`}
                  title="Delete project"
                  className="inline-flex size-6 items-center justify-center rounded-[4px] text-sidebar-foreground/25 transition hover:bg-destructive/10 hover:text-destructive focus-visible:ring-1 focus-visible:ring-sidebar-ring/50"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>

            <div className="minimal-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {threads === undefined || projects === undefined ? (
                <div className="flex items-center gap-2 px-2 py-5 text-[12px] text-sidebar-foreground/40">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  Loading threads
                </div>
              ) : projects.length === 0 ? (
                <div className="mx-1 border border-dashed border-sidebar-border px-3 py-6 text-center">
                  <p className="text-[12px] text-sidebar-foreground/45">Add a project to start a thread.</p>
                  <button type="button" onClick={onCreateProject} className="mt-3 text-[12px] font-medium text-sidebar-foreground/75 hover:text-sidebar-foreground">
                    Add project
                  </button>
                </div>
              ) : visibleThreads.length === 0 ? (
                <div className="mx-1 border border-dashed border-sidebar-border px-3 py-6 text-center">
                  <p className="text-[12px] text-sidebar-foreground/45">
                    {searchQuery.trim() ? "No matching threads." : scopedProject ? `No threads in ${projectName(scopedProject.repoFullName)} yet.` : "No threads yet."}
                  </p>
                  {!searchQuery.trim() ? (
                    <button type="button" onClick={() => openNewThread()} className="mt-3 text-[12px] font-medium text-sidebar-foreground/75 hover:text-sidebar-foreground">
                      Start a thread
                    </button>
                  ) : null}
                </div>
              ) : (
                <ul className="space-y-1">
                  {active.map((thread, index) => (
                    <ThreadRow
                      key={thread.threadId}
                      thread={thread}
                      project={projectsById.get(thread.projectId)}
                      active={thread.threadId === activeThreadId}
                      settled={false}
                      shortcut={showJumpHints && index < 9 ? `⌘${index + 1}` : undefined}
                      isRenaming={renamingThreadId === thread.threadId}
                      renamingTitle={renamingThreadId === thread.threadId ? renamingTitle : ""}
                      onRenamingTitleChange={setRenamingTitle}
                      onActivate={() => activateThread(thread)}
                      onRename={() => {
                        setRenamingThreadId(thread.threadId);
                        setRenamingTitle(thread.title ?? "");
                      }}
                      onCancelRename={() => setRenamingThreadId(null)}
                      onCommitRename={() => void commitRename(thread)}
                      onSettle={(settledValue) => void updateSettlement(thread, settledValue)}
                      onDelete={() => setPendingDeleteThread(thread)}
                    />
                  ))}
                  {visibleSettled.length > 0 ? (
                    <li aria-hidden="true" className="list-none">
                      <div className="mb-1 mt-3 flex items-center gap-2 px-2.5">
                        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-sidebar-foreground/30">Settled</span>
                        <span className="h-px flex-1 bg-sidebar-border/60" />
                      </div>
                    </li>
                  ) : null}
                  {visibleSettled.map((thread, index) => {
                    const shortcutIndex = active.length + index;
                    return (
                      <ThreadRow
                        key={thread.threadId}
                        thread={thread}
                        project={projectsById.get(thread.projectId)}
                        active={thread.threadId === activeThreadId}
                        settled
                        shortcut={showJumpHints && shortcutIndex < 9 ? `⌘${shortcutIndex + 1}` : undefined}
                        isRenaming={renamingThreadId === thread.threadId}
                        renamingTitle={renamingThreadId === thread.threadId ? renamingTitle : ""}
                        onRenamingTitleChange={setRenamingTitle}
                        onActivate={() => activateThread(thread)}
                        onRename={() => {
                          setRenamingThreadId(thread.threadId);
                          setRenamingTitle(thread.title ?? "");
                        }}
                        onCancelRename={() => setRenamingThreadId(null)}
                        onCommitRename={() => void commitRename(thread)}
                        onSettle={(settledValue) => void updateSettlement(thread, settledValue)}
                        onDelete={() => setPendingDeleteThread(thread)}
                      />
                    );
                  })}
                  {hiddenSettledCount > 0 ? (
                    <li className="list-none">
                      <button
                        type="button"
                        onClick={() => setSettledVisibleCount((count) => count + SETTLED_PAGE_COUNT)}
                        className="mt-1 flex h-[30px] w-full items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-sidebar-border font-mono text-[10px] text-sidebar-foreground/40 transition hover:border-sidebar-foreground/25 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
                      >
                        Show {Math.min(hiddenSettledCount, SETTLED_PAGE_COUNT)} more
                        <span className="text-sidebar-foreground/25">
                          ({hiddenSettledCount} settled hidden)
                        </span>
                      </button>
                    </li>
                  ) : null}
                </ul>
              )}
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

      <Dialog
        open={Boolean(pendingDeleteThread)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteThread(null);
            setActionError(null);
          }
        }}
      >
        <DialogContent className="max-w-[320px] gap-3 p-4" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-sm">Delete thread?</DialogTitle>
            <DialogDescription className="line-clamp-2 text-[12px]">
              {pendingDeleteThread?.title ?? pendingDeleteThread?.threadId}
            </DialogDescription>
          </DialogHeader>
          {actionError ? <p className="text-xs text-destructive" role="alert">{actionError}</p> : null}
          <DialogFooter className="flex-row justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={Boolean(deletingThreadId)}
              onClick={() => setPendingDeleteThread(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={Boolean(deletingThreadId)}
              onClick={() => void confirmDeleteThread()}
            >
              {deletingThreadId ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {actionError && !pendingDeleteThread ? (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 border border-destructive/30 bg-popover px-3 py-2 text-xs text-destructive">
          {actionError}
        </div>
      ) : null}
    </>
  );
}
