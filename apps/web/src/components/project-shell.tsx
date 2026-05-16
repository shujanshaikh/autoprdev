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
import { UserButton } from "@clerk/tanstack-react-start";
import { Authenticated, Unauthenticated, useMutation } from "convex/react";
import {
  GitPullRequest,
  Home,
  Loader2,
  MessageSquare,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
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
  SidebarProvider,
  useSidebar,
} from "@autopr/ui/components/sidebar";

import { RouteTransition } from "@/components/route-transition";
import { cn } from "@autopr/ui/lib/utils";


export interface ProjectThread {
  threadId: string;
  title: string;
  isLive?: boolean;
  updatedAt: number;
}


const projectShellCache = new Map<string, {
  repoFullName?: string;
  threads?: ProjectThread[];
}>();


function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}


function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex size-1.5 shrink-0", className)}>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60 opacity-40" />
      <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
    </span>
  );
}


export function ProjectSidebar({
  projectId,
  repoFullName,
  threads,
  activeThreadId,
}: {
  projectId: string;
  repoFullName?: string;
  threads: ProjectThread[] | undefined;
  activeThreadId?: string;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const { setOpen } = useSidebar();
  const removeThread = useMutation(api.threads.remove);
  const [deletingThreadId, setDeletingThreadId] = useState<string | undefined>();
  const [pendingDeleteThread, setPendingDeleteThread] = useState<ProjectThread | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const displayName = repoFullName ?? "autopr";
  const [owner, repo] = displayName.includes("/")
    ? displayName.split("/")
    : [undefined, displayName];

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleThreads = useMemo(() => {
    if (threads === undefined) {
      return undefined;
    }

    if (!normalizedSearchQuery) {
      return threads.slice(0, 12);
    }

    return threads
      .filter((thread) => {
        const haystack = `${thread.title} ${thread.threadId}`.toLowerCase();
        return haystack.includes(normalizedSearchQuery);
      })
      .slice(0, 12);
  }, [normalizedSearchQuery, threads]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setOpen]);

  function handleDeleteThread(event: MouseEvent<HTMLButtonElement>, thread: ProjectThread) {
    event.preventDefault();
    event.stopPropagation();
    setPendingDeleteThread(thread);
  }

  async function confirmDeleteThread() {
    if (!pendingDeleteThread) {
      return;
    }

    const thread = pendingDeleteThread;
    setDeletingThreadId(thread.threadId);
    try {
      await removeThread({ threadId: thread.threadId });
      setPendingDeleteThread(undefined);
      if (thread.threadId === activeThreadId) {
        navigate({ to: "/project/$projectId", params: { projectId } });
      }
      router.invalidate();
    } finally {
      setDeletingThreadId(undefined);
    }
  }

  return (
    <>
    <Sidebar collapsible="icon" variant="inset">
      {/* ── Brand ─────────────────────────────────────────────── */}
      <SidebarHeader className="h-12 justify-center border-b border-sidebar-border/60 px-3 py-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link to="/dashboard" />}
              tooltip={displayName}
              className="h-10 gap-3 px-2 group-data-[collapsible=icon]:justify-center"
            >
              <span className="inline-block size-1.5 shrink-0 bg-sidebar-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] leading-none group-data-[collapsible=icon]:hidden">
                {owner ? (
                  <>
                    <span className="text-sidebar-foreground/55">
                      {owner}
                      <span className="opacity-50">/</span>
                    </span>
                    <span className="font-semibold text-sidebar-foreground">{repo}</span>
                  </>
                ) : (
                  <span className="font-semibold text-sidebar-foreground">{displayName}</span>
                )}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <div className="px-3 pt-3 pb-2 group-data-[collapsible=icon]:hidden">
        <div className="relative flex h-8 w-full items-center border border-sidebar-border bg-sidebar transition focus-within:border-sidebar-foreground/60">
          <Search
            className="pointer-events-none absolute left-2 size-3.5 text-sidebar-foreground/45"
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
            placeholder="search…"
            aria-label="Search threads"
            className="h-full min-w-0 flex-1 bg-transparent pr-11 pl-8 font-mono text-[11px] text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/45"
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
          ) : (
            <kbd className="pointer-events-none absolute right-2 font-mono text-[10px] tracking-wide text-sidebar-foreground/30">
              ⌘K
            </kbd>
          )}
        </div>
      </div>

      <SidebarContent>
        <SidebarGroup className="px-2 py-1">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0">
              <NavLink to={"/dashboard"} icon={Home} label="Dashboard" />
              <NavLink
                to="/project/$projectId"
                params={{ projectId }}
                icon={MessageSquare}
                label="Threads"
                count={threads?.length}
              />
              <NavLink
                to="/project/$projectId/pulls"
                params={{ projectId }}
                icon={GitPullRequest}
                label="View pull request"
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="px-2 pt-3 pb-1 group-data-[collapsible=icon]:hidden">
          <div className="mb-1.5 flex items-center justify-between px-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-sidebar-foreground/50">
              recents
            </span>
            {threads && threads.length > 0 ? (
              <span className="font-mono text-[10px] tabular-nums text-sidebar-foreground/35">
                {String(normalizedSearchQuery ? visibleThreads?.length ?? 0 : threads.length).padStart(2, "0")}
              </span>
            ) : null}
          </div>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0">
              {threads === undefined ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2
                    className="size-3.5 animate-spin text-sidebar-foreground/30"
                    aria-hidden="true"
                  />
                </div>
              ) : threads.length === 0 ? (
                <div className="px-2 py-6 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/30">
                  no threads
                </div>
              ) : visibleThreads?.length === 0 ? (
                <div className="px-2 py-6 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/30">
                  no matches
                </div>
              ) : (
                visibleThreads?.map((thread) => {
                  const isActive = thread.threadId === activeThreadId;
                  return (
                    <SidebarMenuItem key={thread.threadId}>
                      <SidebarMenuButton
                        isActive={isActive}
                        render={
                          <Link
                            to="/project/$projectId/thread/$threadId"
                            params={{ projectId, threadId: thread.threadId }}
                          />
                        }
                        tooltip={thread.title}
                        className={cn(
                          "group/thread h-8 gap-2 px-2 font-mono",
                          "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-flex w-2 shrink-0 text-[10px] leading-none text-sidebar-foreground/30",
                            isActive && "text-sidebar-foreground",
                          )}
                          aria-hidden="true"
                        >
                          {isActive ? "▸" : ""}
                        </span>
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-[12px]",
                            isActive
                              ? "text-sidebar-foreground"
                              : "text-sidebar-foreground/75",
                          )}
                        >
                          {thread.title}
                        </span>
                        {thread.isLive ? (
                          <LiveDot className="ml-auto group-hover/thread:opacity-0" />
                        ) : (
                          <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-sidebar-foreground/30 group-hover/thread:opacity-0">
                            {relativeTime(thread.updatedAt)}
                          </span>
                        )}
                      </SidebarMenuButton>
                      <SidebarMenuAction
                        type="button"
                        showOnHover
                        disabled={deletingThreadId === thread.threadId}
                        aria-label={`Delete thread ${thread.title}`}
                        title="Delete thread"
                        onClick={(event) => handleDeleteThread(event, thread)}
                        className="text-sidebar-foreground/35 hover:bg-destructive/10 hover:text-destructive"
                      >
                        {deletingThreadId === thread.threadId ? (
                          <Loader2 className="animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 aria-hidden="true" />
                        )}
                      </SidebarMenuAction>
                    </SidebarMenuItem>
                  );
                })
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="mt-auto border-t border-sidebar-border/60 p-2">
        <SidebarMenu className="gap-0">
          <SidebarMenuItem>
            <div className="flex h-9 items-center justify-between gap-2.5 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
              <span className="min-w-0 truncate font-mono text-[11px] text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
                account
              </span>
              <UserButton
                appearance={{
                  elements: {
                    avatarBox: "size-6 rounded-none",
                  },
                }}
              />
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
    <Dialog open={Boolean(pendingDeleteThread)} onOpenChange={(open) => !open && setPendingDeleteThread(undefined)}>
      <DialogContent className="max-w-[320px] gap-3 p-4" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Delete thread?</DialogTitle>
          <DialogDescription className="line-clamp-2 font-mono text-[11px]">
            {pendingDeleteThread?.title}
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

function NavLink({
  to,
  params,
  icon: Icon,
  label,
  count,
}: {
  to: "/dashboard" | "/project/$projectId" | "/project/$projectId/pulls";
  params?: { projectId: string };
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  count?: number;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link to={to} params={params} />}
        tooltip={label}
        className="h-8 gap-2.5 px-2 font-mono group-data-[collapsible=icon]:justify-center"
      >
        <Icon
          className="size-3.5 text-sidebar-foreground/55"
          aria-hidden={true}
        />
        <span className="flex-1 text-left text-[12px] text-sidebar-foreground/85 group-data-[collapsible=icon]:hidden">
          {label}
        </span>
        {typeof count === "number" ? (
          <span className="ml-auto font-mono text-[10px] tabular-nums text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden">
            {String(count).padStart(2, "0")}
          </span>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}


export function ProjectShell({
  projectId,
  repoFullName,
  threads,
  activeThreadId,
  children,
}: {
  projectId: string;
  repoFullName?: string;
  threads: ProjectThread[] | undefined;
  activeThreadId?: string;
  children: ReactNode;
}) {
  const cached = projectShellCache.get(projectId);
  const [cachedRepoFullName, setCachedRepoFullName] = useState(repoFullName ?? cached?.repoFullName);
  const [cachedThreads, setCachedThreads] = useState<ProjectThread[] | undefined>(threads ?? cached?.threads);

  useEffect(() => {
    const next = projectShellCache.get(projectId) ?? {};

    if (repoFullName !== undefined) {
      next.repoFullName = repoFullName;
      setCachedRepoFullName(repoFullName);
    }

    if (threads !== undefined) {
      next.threads = threads;
      setCachedThreads(threads);
    }

    projectShellCache.set(projectId, next);
  }, [projectId, repoFullName, threads]);

  return (
    <SidebarProvider className="project-shell h-dvh max-h-dvh overflow-hidden">
      <ProjectSidebar
        projectId={projectId}
        repoFullName={repoFullName ?? cachedRepoFullName}
        threads={threads ?? cachedThreads}
        activeThreadId={activeThreadId}
      />
      <SidebarInset>
        <RouteTransition>{children}</RouteTransition>
      </SidebarInset>
    </SidebarProvider>
  );
}


export function AuthGate({ children }: { children: ReactNode }) {
  return (
    <>
      <Authenticated>{children}</Authenticated>

      <Unauthenticated>
        <main className="grid min-h-svh place-items-center px-5">
          <Link to="/dashboard" className="px-4 py-2 text-sm text-foreground/70 hover:text-foreground transition-colors">
            Sign in from dashboard
          </Link>
        </main>
      </Unauthenticated>

    </>
  );
}
