import { createFileRoute } from "@tanstack/react-router";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@autopr/ui/components/select";
import {
  useMutation as useReactMutation,
  useQuery as useReactQuery,
} from "@tanstack/react-query";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  ArrowUp,
  GitBranch,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Search,
  Trash2,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ThreadTabs } from "#/components/thread/thread-tabs";

function relativeTime(date: number) {
  const seconds = Math.floor((Date.now() - date) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type GithubBranch = {
  name: string;
  sha: string;
  protected: boolean;
};

const EMPTY_BRANCHES: GithubBranch[] = [];

function getThreadTabsStorageKey(projectId: string) {
  return `autopr:project:${projectId}:thread-tabs`;
}

function readStoredThreadTabs(projectId: string) {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(getThreadTabsStorageKey(projectId)) ?? "[]");
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
    }
  } catch {
    // Ignore invalid stored tab state.
  }

  return [];
}

function writeStoredThreadTabs(projectId: string, tabs: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(getThreadTabsStorageKey(projectId), JSON.stringify(tabs));
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data && typeof data === "object" && "error" in data ? String(data.error) : "Request failed.";
    throw new Error(error);
  }
  return data as T;
}


function ThreadRow({
  thread,
  projectId,
  onDelete,
  isDeleting,
}: {
  thread: {
    threadId: string;
    title: string;
    isLive?: boolean;
    updatedAt: number;
  };
  projectId: string;
  onDelete: (threadId: string, title: string) => void;
  isDeleting: boolean;
}) {
  return (
    <div className="group flex items-center transition-colors hover:bg-muted/40">
      <Link
        to="/project/$projectId/thread/$threadId"
        params={{ projectId, threadId: thread.threadId }}
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5"
      >
        <MessageSquare
          className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary/70"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[13px] font-semibold leading-tight text-foreground/90 group-hover:text-foreground">
              {thread.title}
            </p>
            {thread.isLive ? (
              <span className="inline-flex items-center gap-1 border border-primary/20 bg-primary/8 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.12em] text-primary">
                <span className="size-1 animate-pulse rounded-full bg-primary" />
                live
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">
            {relativeTime(thread.updatedAt)}
          </p>
        </div>
        <ArrowRight
          className="size-3.5 shrink-0 text-muted-foreground/30 transition-all group-hover:translate-x-0.5 group-hover:text-muted-foreground/60"
          aria-hidden="true"
        />
      </Link>
      <button
        type="button"
        disabled={isDeleting}
        onClick={() => onDelete(thread.threadId, thread.title)}
        className="mr-2 inline-flex size-8 items-center justify-center border border-destructive/20 bg-destructive/5 text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={`Delete thread ${thread.title}`}
        title="Delete thread"
      >
        {isDeleting ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}


function ProjectOverviewPage() {
  const { projectId } = Route.useParams();
  const router = useRouter();
  const navigate = useNavigate();
  const { isAuthenticated } = useConvexAuth();
  const project = useQuery(api.projects.get, isAuthenticated ? { projectId } : "skip");
  const threads = useQuery(api.threads.listByProject, isAuthenticated ? { projectId } : "skip");
  const createThread = useMutation(api.threads.create);
  const removeThread = useMutation(api.threads.remove);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [deletingThreadId, setDeletingThreadId] = useState<string | undefined>();
  const [pendingDeleteThread, setPendingDeleteThread] = useState<{ threadId: string; title: string } | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [selectedBranch, setSelectedBranch] = useState("");
  const [promptValue, setPromptValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [openThreadTabs, setOpenThreadTabs] = useState<string[]>(() => readStoredThreadTabs(projectId));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const threadLookup = useMemo(() => new Map((threads ?? []).map((t) => [t.threadId, t])), [threads]);
  const visibleThreadTabs = useMemo(
    () => openThreadTabs
      .map((id) => threadLookup.get(id))
      .filter((tab): tab is NonNullable<typeof tab> => tab !== undefined && tab !== null),
    [openThreadTabs, threadLookup],
  );
  const openThreads = threads?.filter((t) => t.isLive) ?? [];
  const currentBranch = project?.currentBranch ?? project?.repoBranch ?? project?.defaultBranch ?? "main";
  const filteredThreads = threads?.filter((t) =>
    searchQuery ? t.title.toLowerCase().includes(searchQuery.toLowerCase()) : true,
  );

  const branchesQuery = useReactQuery({
    queryKey: ["github", "branches", project?.repoOwner, project?.repoName],
    enabled: isAuthenticated && Boolean(project),
    queryFn: async () => {
      if (!project) {
        return { branches: EMPTY_BRANCHES };
      }

      return readJson<{ branches: GithubBranch[] }>(
        await fetch(
          `/api/github/repositories/${encodeURIComponent(project.repoOwner)}/${encodeURIComponent(project.repoName)}/branches`,
        ),
      );
    },
  });

  const branches = branchesQuery.data?.branches ?? EMPTY_BRANCHES;
  const isLoadingBranches = branchesQuery.isPending && Boolean(project);
  const branchesError =
    branchesQuery.error instanceof Error
      ? branchesQuery.error.message
      : branchesQuery.isError
        ? "Could not load branches."
        : undefined;

  const switchBranchMutation = useReactMutation({
    mutationFn: async (branch: string) =>
      readJson<{ status: "ready" }>(
        await fetch(`/api/project/${projectId}/branch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branch }),
        }),
      ),
    onMutate: () => {
      setError(undefined);
    },
    onError: (branchError) => {
      setSelectedBranch(currentBranch);
      setError(branchError instanceof Error ? branchError.message : "Could not switch branches.");
    },
  });

  const isSwitchingBranch = switchBranchMutation.isPending;
  const mutateSwitchBranch = switchBranchMutation.mutate;
  const displayedError = error ?? branchesError;

  const startThread = useCallback(async (initialPrompt?: string) => {
    if (!project || project.sandboxStatus !== "ready") return;
    const prompt = (initialPrompt ?? promptValue).trim();
    setIsCreatingThread(true);
    setError(undefined);
    try {
      const threadId = await createThread({ projectId, title: prompt || "New thread" });
      await router.preloadRoute({ to: "/project/$projectId/thread/$threadId", params: { projectId, threadId }, search: prompt ? { prompt } : undefined });
      navigate({ to: "/project/$projectId/thread/$threadId", params: { projectId, threadId }, search: prompt ? { prompt } : undefined });
    } catch (threadError) {
      setError(threadError instanceof Error ? threadError.message : "Could not create a thread.");
      setIsCreatingThread(false);
    }
  }, [project, projectId, promptValue, createThread, router, navigate]);

  const handlePromptSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      void startThread();
    },
    [startThread],
  );

  const handleDeleteThread = useCallback(
    async (threadId: string, title: string) => {
      setPendingDeleteThread({ threadId, title });
    },
    [],
  );

  const confirmDeleteThread = useCallback(async () => {
    if (!pendingDeleteThread) {
      return;
    }

    setDeletingThreadId(pendingDeleteThread.threadId);
    setError(undefined);
    try {
      await removeThread({ threadId: pendingDeleteThread.threadId });
      setPendingDeleteThread(undefined);
    } catch (threadError) {
      setError(threadError instanceof Error ? threadError.message : "Could not delete the thread.");
    } finally {
      setDeletingThreadId(undefined);
    }
  }, [pendingDeleteThread, removeThread]);

  const isConfirmingDelete = Boolean(pendingDeleteThread);
  const isDeletingPendingThread = Boolean(pendingDeleteThread && deletingThreadId === pendingDeleteThread.threadId);

  const handleSelectThreadTab = useCallback((nextThreadId: string) => {
    navigate({ to: "/project/$projectId/thread/$threadId", params: { projectId, threadId: nextThreadId } });
  }, [navigate, projectId]);

  const handleCloseThreadTab = useCallback((closedThreadId: string) => {
    setOpenThreadTabs((tabs) => {
      const nextTabs = tabs.filter((id) => id !== closedThreadId);
      writeStoredThreadTabs(projectId, nextTabs);
      return nextTabs;
    });
  }, [projectId]);

  const closeDeleteDialog = useCallback(() => {
    if (isDeletingPendingThread) {
      return;
    }

    setPendingDeleteThread(undefined);
  }, [isDeletingPendingThread]);

  useEffect(() => {
    writeStoredThreadTabs(projectId, openThreadTabs);
  }, [openThreadTabs, projectId]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.cssText += `; height: auto; height: ${Math.min(el.scrollHeight, 160)}px;`;
  }, [promptValue]);

  useEffect(() => {
    if (!project) return;
    setSelectedBranch(currentBranch);
  }, [currentBranch, project]);

  const switchBranch = useCallback(async (branch: string) => {
    if (!project || branch === currentBranch) {
      setSelectedBranch(branch);
      return;
    }

    if (openThreads.length > 0) {
      const confirmed = window.confirm("Switching branch affects the sandbox used by new and existing threads.");
      if (!confirmed) {
        setSelectedBranch(currentBranch);
        return;
      }
    }

    setSelectedBranch(branch);
    mutateSwitchBranch(branch);
  }, [currentBranch, openThreads.length, project, mutateSwitchBranch]);

  const quickActions = [
    "Summarize latest changes",
    "Review my latest PR",
    "Suggest a new feature",
    "Create a task for…",
  ];

  return (
    <Dialog open={isConfirmingDelete} onOpenChange={(open) => (!open ? closeDeleteDialog() : null)}>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {visibleThreadTabs.length > 0 ? (
              <header className="relative z-10 flex h-11 shrink-0 items-stretch border-b border-border bg-background">
                <ThreadTabs
                  tabs={visibleThreadTabs}
                  onSelectTab={handleSelectThreadTab}
                  onCloseTab={handleCloseThreadTab}
                  newTabActive
                  newTabLabel="Project threads"
                />
              </header>
            ) : null}
            <div className="minimal-scrollbar relative flex flex-1 flex-col overflow-y-auto">
              {project === undefined || threads === undefined ? (
                <div className="grid flex-1 place-items-center">
                  <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
                    <Loader2 className="size-5 animate-spin text-primary/50" aria-hidden="true" />
                    <span className="font-mono text-xs tracking-wide">Loading project…</span>
                  </div>
                </div>
              ) : !project ? (
                <div className="flex flex-1 items-center justify-center">
                  <div className="border border-border px-6 py-5 text-sm text-muted-foreground">
                    Project not found.
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-1 flex-col items-center justify-center px-5 py-16 sm:px-8">
                    <div className="w-full max-w-[600px]">
                      {/* Heading */}
                      <div className="mb-6 text-center">
                        <h1 className="text-lg font-semibold tracking-tight text-foreground">
                          What do you want to work on?
                        </h1>
                        <div className="mt-2 flex flex-wrap items-center justify-center gap-2 font-mono text-[11px] text-muted-foreground/70">
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <GitBranch className="size-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{project.repoFullName ?? "project"}</span>
                          </span>
                          <Select value={selectedBranch} onValueChange={(branch) => branch && void switchBranch(branch)}>
                            <SelectTrigger
                              size="sm"
                              className="max-w-56"
                              disabled={
                                project.sandboxStatus !== "ready" ||
                                project.branchSwitchStatus === "switching" ||
                                isCreatingThread ||
                                isLoadingBranches ||
                                isSwitchingBranch
                              }
                            >
                              <SelectValue placeholder={isLoadingBranches ? "Loading branches" : currentBranch} />
                            </SelectTrigger>
                            <SelectContent align="center" className="max-h-72">
                              {branches.map((branch) => (
                                <SelectItem key={branch.sha} value={branch.name}>
                                  <span className="flex min-w-0 items-center gap-2">
                                    <GitBranch className="size-3.5" aria-hidden="true" />
                                    <span className="truncate font-mono">{branch.name}</span>
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {isSwitchingBranch || project.branchSwitchStatus === "switching" ? (
                            <Loader2 className="size-3 animate-spin text-primary" aria-hidden="true" />
                          ) : null}
                        </div>
                      </div>

                      <form onSubmit={handlePromptSubmit}>
                        <div
                          className={`border bg-background transition-shadow ${isFocused
                            ? "border-primary/40 shadow-[0_0_0_3px_oklch(0.90_0.15_115.6/0.08)]"
                            : "border-border hover:border-border/80"
                            }`}
                        >
                          <div className="px-4 pt-3.5 pb-2">
                            <textarea
                              ref={textareaRef}
                              value={promptValue}
                              onChange={(e) => setPromptValue(e.target.value)}
                              onFocus={() => setIsFocused(true)}
                              onBlur={() => setIsFocused(false)}
                              placeholder={`Ask ${project.repoFullName?.split("/")[1] ?? "the agent"} anything…`}
                              disabled={project.sandboxStatus !== "ready" || isCreatingThread}
                              rows={1}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  void startThread();
                                }
                              }}
                              className="w-full resize-none bg-transparent text-[14px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-50"
                              style={{ minHeight: "24px", maxHeight: "160px" }}
                            />
                          </div>

                          <div className="flex items-center justify-between px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[10px] tracking-wide text-muted-foreground/50">
                                autopr agent
                              </span>
                            </div>
                            <button
                              type="submit"
                              disabled={project.sandboxStatus !== "ready" || isCreatingThread}
                              className="inline-flex size-7 items-center justify-center bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <ArrowUp className="size-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </form>

                      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                        {quickActions.map((action) => (
                          <button
                            key={action}
                            type="button"
                             onClick={() => {
                               setPromptValue(action);
                               void startThread(action);
                             }}
                            disabled={project.sandboxStatus !== "ready"}
                            className="border border-border/60 px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {action}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {project.sandboxStatus === "creating" ? (
                    <div className="mx-auto w-full max-w-[600px] px-5">
                      <div className="border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-700 dark:text-amber-300">
                        <Loader2 className="mr-2 inline size-3.5 animate-spin" aria-hidden="true" />
                        Creating sandbox and cloning repository. Threads unlock when ready.
                      </div>
                    </div>
                  ) : null}

                  {project.sandboxStatus === "failed" ? (
                    <div className="mx-auto w-full max-w-[600px] px-5">
                      <div className="border border-destructive/25 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
                        <p>{project.sandboxError ?? "Sandbox creation failed."}</p>
                        <Link
                          to="/dashboard"
                          className="mt-2 inline-flex text-foreground underline underline-offset-4"
                        >
                          Back to dashboard
                        </Link>
                      </div>
                    </div>
                  ) : null}

                  {project.branchSwitchStatus === "switching" ? (
                    <div className="mx-auto w-full max-w-[600px] px-5 pt-2">
                      <div className="border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-700 dark:text-amber-300">
                        <Loader2 className="mr-2 inline size-3.5 animate-spin" aria-hidden="true" />
                        Switching branch and pulling latest changes…
                      </div>
                    </div>
                  ) : null}

                  {project.branchSwitchStatus === "failed" && project.branchSwitchError ? (
                    <div className="mx-auto w-full max-w-[600px] px-5 pt-2">
                      <div className="border border-destructive/25 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
                        {project.branchSwitchError}
                      </div>
                    </div>
                  ) : null}

                  {displayedError ? (
                    <div className="mx-auto w-full max-w-[600px] px-5 pt-2">
                      <div className="border border-destructive/25 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
                        {displayedError}
                      </div>
                    </div>
                  ) : null}

                  <div className="mx-auto w-full max-w-[600px] px-5 pt-2 pb-12">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex items-center gap-2">
                        {openThreads.length > 0 ? (
                          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/60">
                            <span className="size-1.5 rounded-full bg-primary/70" />
                            {openThreads.length} live
                          </span>
                        ) : null}
                        <h2 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/50">
                          Threads
                        </h2>
                      </div>

                      <div className="ml-auto flex items-center gap-1.5">
                        <label className="flex h-8 w-44 items-center gap-1.5 border border-border/60 bg-background px-2.5 text-xs text-muted-foreground transition-colors focus-within:border-primary/30">
                          <Search className="size-3 shrink-0 text-muted-foreground/40" aria-hidden="true" />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search…"
                            className="w-full bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => void startThread()}
                          disabled={project.sandboxStatus !== "ready" || isCreatingThread}
                          className="inline-flex h-8 items-center gap-1.5 border border-primary/20 bg-primary/6 px-2.5 font-mono text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <MessageSquarePlus className="size-3" aria-hidden="true" />
                          New
                        </button>
                      </div>
                    </div>

                    <div className="divide-y divide-border/60 border border-border/60 bg-background">
                      {filteredThreads === undefined ? (
                        <div className="flex min-h-24 items-center justify-center text-[13px] text-muted-foreground/60">
                          <Loader2 className="mr-2 size-3.5 animate-spin" aria-hidden="true" />
                          Loading threads…
                        </div>
                      ) : filteredThreads.length === 0 ? (
                        <div className="px-4 py-8 text-center text-[13px] text-muted-foreground/50">
                          {searchQuery ? (
                            <>No threads match &quot;{searchQuery}&quot;</>
                          ) : (
                            "No threads yet. Start one above."
                          )}
                        </div>
                      ) : (
                        filteredThreads.map((thread) => (
                          <ThreadRow
                            key={thread.threadId}
                            thread={thread}
                            projectId={projectId}
                            onDelete={handleDeleteThread}
                            isDeleting={deletingThreadId === thread.threadId}
                          />
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete thread?</DialogTitle>
            <DialogDescription>
              This permanently deletes <span className="font-semibold text-foreground">{pendingDeleteThread?.title ?? "this thread"}</span> and all its messages.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={isDeletingPendingThread} onClick={closeDeleteDialog}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={isDeletingPendingThread} onClick={() => void confirmDeleteThread()}>
              {isDeletingPendingThread ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              Delete thread
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}

export const Route = createFileRoute("/project/$projectId/")({ component: ProjectOverviewPage });
