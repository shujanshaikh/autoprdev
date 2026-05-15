import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { api } from "@autopr/backend/convex/_generated/api";
import { cn } from "@autopr/ui/lib/utils";
import { SidebarTrigger } from "@autopr/ui/components/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@autopr/ui/components/tooltip";
import { useConvexAuth, useQuery } from "convex/react";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { PierreDiffWorkerPoolProvider } from "@/components/ai-elements/pierre-diff-view";
import Loader from "@/components/loader";
import { toUIMessage } from "@/lib/chat-messages";
import { ThreadChat } from "#/components/thread/thread-chat";
import { ThreadTabs } from "#/components/thread/thread-tabs";
import { readStoredThreadTabs, writeStoredThreadTabs } from "#/components/thread/thread-tabs-storage";

function ProjectThreadPageContent() {
  const { projectId, threadId } = Route.useParams();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { prompt?: string };
  const { isAuthenticated } = useConvexAuth();
  const initialPrompt = search.prompt?.trim() || undefined;
  const project = useQuery(api.projects.get, isAuthenticated ? { projectId } : "skip");
  const thread = useQuery(api.threads.get, isAuthenticated ? { threadId } : "skip");
  const threads = useQuery(api.threads.listByProject, isAuthenticated ? { projectId } : "skip");
  const dbMessages = useQuery(api.messages.listByThread, isAuthenticated ? { threadId } : "skip");
  const [diffPanelOpen, setDiffPanelOpen] = useState(false);
  const [diffCount, setDiffCount] = useState(0);
  const [openThreadTabs, setOpenThreadTabs] = useState<string[]>(() => readStoredThreadTabs(projectId, threadId));

  const initialMessages = useMemo(() => dbMessages?.map(toUIMessage) ?? [], [dbMessages]);
  const shouldAutoSubmitInitialPrompt = Boolean(initialPrompt && dbMessages && dbMessages.length === 0);
  const loading = project === undefined || thread === undefined || dbMessages === undefined;
  const notFound = !loading && (!project || !thread || thread.projectId !== projectId);
  const disabled = !project || project.sandboxStatus !== "ready";
  const threadLookup = useMemo(() => new Map((threads ?? []).map((t) => [t.threadId, t])), [threads]);
  const visibleThreadTabs = useMemo(
    () => openThreadTabs.map((id) => threadLookup.get(id) ?? (id === threadId ? thread : undefined) ?? { threadId: id }),
    [openThreadTabs, threadLookup, thread, threadId],
  );
  useEffect(() => {
    setOpenThreadTabs((tabs) => tabs.includes(threadId) ? tabs : [...tabs, threadId]);
  }, [threadId]);

  useEffect(() => {
    writeStoredThreadTabs(projectId, openThreadTabs);
  }, [openThreadTabs, projectId]);

  useEffect(() => {
    setDiffCount(0);
    setDiffPanelOpen(false);
  }, [threadId]);

  const handleDiffCountChange = useCallback((count: number) => {
    setDiffCount(count);
    if (count === 0) {
      setDiffPanelOpen(false);
    }
  }, []);

  const handleInitialPromptConsumed = useCallback(() => {
    navigate({ to: ".", search: (prev) => ({ ...prev, prompt: undefined }), replace: true, resetScroll: false });
  }, [navigate]);

  const handleSelectThreadTab = useCallback((nextThreadId: string) => {
    setOpenThreadTabs((tabs) => {
      const nextTabs = tabs.includes(nextThreadId) ? tabs : [...tabs, nextThreadId];
      writeStoredThreadTabs(projectId, nextTabs);
      return nextTabs;
    });
    navigate({
      to: "/project/$projectId/thread/$threadId",
      params: { projectId, threadId: nextThreadId },
      resetScroll: false,
    });
  }, [navigate, projectId]);

  const handleCloseThreadTab = useCallback((closedThreadId: string) => {
    setOpenThreadTabs((tabs) => {
      if (tabs.length === 1) {
        return tabs;
      }

      const closedIndex = tabs.indexOf(closedThreadId);
      const nextTabs = tabs.filter((id) => id !== closedThreadId);
      if (closedThreadId === threadId) {
        const fallbackThreadId = nextTabs[Math.max(0, closedIndex - 1)] ?? nextTabs[0];
        if (fallbackThreadId) {
          navigate({
            to: "/project/$projectId/thread/$threadId",
            params: { projectId, threadId: fallbackThreadId },
            resetScroll: false,
          });
        }
      }
      writeStoredThreadTabs(projectId, nextTabs);
      return nextTabs;
    });
  }, [navigate, projectId, threadId]);


  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <header className="relative z-10 flex h-11 shrink-0 items-stretch border-b border-border bg-background">
              <div className="flex shrink-0 items-center border-r border-border px-2">
                <SidebarTrigger />
              </div>


              <ThreadTabs
                tabs={visibleThreadTabs}
                activeThreadId={threadId}
                resolveFallbackTitle={(tab) =>
                  tab.threadId === threadId ? initialPrompt : undefined
                }
                onSelectTab={handleSelectThreadTab}
                onCloseTab={handleCloseThreadTab}
                canCloseTab={() => visibleThreadTabs.length > 1}
                onNewTab={() =>
                  navigate({ to: "/project/$projectId", params: { projectId } })
                }
                newTabLabel="Open project threads"
              />

              {/* Changes toggle — mono label + count, primary fill when open */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-controls="thread-changes-panel"
                      aria-expanded={diffPanelOpen}
                      aria-label={diffPanelOpen ? "Hide changes" : "Show changes"}
                      data-diff-panel-state={diffPanelOpen ? "open" : "closed"}
                      onClick={() => setDiffPanelOpen((open) => !open)}
                      className={cn(
                        "group/changes-trigger relative flex h-full shrink-0 items-center gap-2 border-l border-border px-3.5 font-mono text-[10px] uppercase tracking-[0.22em]",
                        diffPanelOpen
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-1.5 shrink-0",
                          diffPanelOpen ? "bg-primary-foreground" : "bg-current",
                        )}
                      />
                      <span>changes</span>
                      <span
                        className={cn(
                          "tabular-nums",
                          !diffPanelOpen && diffCount === 0 && "text-muted-foreground/40",
                        )}
                      >
                        {diffCount > 99 ? "99+" : String(diffCount).padStart(2, "0")}
                      </span>
                      <span className="sr-only">
                        {diffPanelOpen ? "Hide changes" : "Show changes"}
                      </span>
                    </button>
                  }
                />
                <TooltipContent side="bottom" sideOffset={8}>
                  {diffPanelOpen
                    ? "Hide Changes"
                    : diffCount > 0
                      ? `Show Changes (${diffCount > 99 ? "99+" : diffCount})`
                      : "Show Changes"}
                </TooltipContent>
              </Tooltip>
            </header>

            <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <PierreDiffWorkerPoolProvider>
              {notFound ? (
                <div className="border border-border p-5 text-sm text-muted-foreground">Thread not found.</div>
              ) : loading ? (
                <section className="min-h-0 w-full min-w-0 flex-1">
                  <Loader />
                </section>
              ) : (
                <ThreadChat
                  key={threadId}
                  projectId={projectId}
                  threadId={threadId}
                  currentRunId={thread?.currentRunId}
                  initialMessages={initialMessages}
                  initialPrompt={shouldAutoSubmitInitialPrompt ? initialPrompt : undefined}
                  disabled={disabled}
                  diffPanelOpen={diffPanelOpen}
                  onDiffPanelOpenChange={setDiffPanelOpen}
                  onDiffCountChange={handleDiffCountChange}
                  onInitialPromptConsumed={handleInitialPromptConsumed}
                  project={project}
                  thread={thread}
                />
              )}
              </PierreDiffWorkerPoolProvider>
            </main>
          </div>
  );
}

function ProjectThreadPage() {
  return (
    <Suspense fallback={<Loader />}>
      <ProjectThreadPageContent />
    </Suspense>
  );
}

export const Route = createFileRoute("/project/$projectId/thread/$threadId")({ component: ProjectThreadPage });
