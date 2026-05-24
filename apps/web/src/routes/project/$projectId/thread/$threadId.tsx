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
import { isCodexModelId, isCodexReasoningEffortForModel } from "#/lib/codex-models";
import { readStoredThreadTabs, writeStoredThreadTabs } from "#/components/thread/thread-tabs-storage";

function ProjectThreadPageContent() {
  const { projectId, threadId } = Route.useParams();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { prompt?: string; model?: string; reasoningEffort?: string };
  const { isAuthenticated } = useConvexAuth();
  const initialPrompt = search.prompt?.trim() || undefined;
  const initialModel = isCodexModelId(search.model) ? search.model : undefined;
  const initialReasoningEffort = isCodexReasoningEffortForModel(initialModel, search.reasoningEffort)
    ? search.reasoningEffort
    : undefined;
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
    navigate({
      to: ".",
      search: (prev) => ({ ...prev, prompt: undefined, model: undefined, reasoningEffort: undefined }),
      replace: true,
      resetScroll: false,
    });
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
                        "group/changes-trigger relative flex h-full w-11 shrink-0 items-center justify-center border-l border-border text-muted-foreground/85",
                        "transition-[background-color,color,transform,box-shadow] duration-200 ease-out",
                        "hover:bg-foreground/[0.06] hover:text-foreground active:bg-foreground/[0.10]",
                        "focus-visible:bg-foreground/[0.06] focus-visible:ring-[1.5px] focus-visible:ring-sidebar-primary/40 focus-visible:ring-offset-0",
                        diffPanelOpen && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                      )}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="size-[16px]"
                        aria-hidden
                      >
                        <path
                          d="M9 5 L5.5 5 A2.5 2.5 0 0 0 3 7.5 L3 16.5 A2.5 2.5 0 0 0 5.5 19 L9 19 Z"
                          fill="currentColor"
                          stroke="none"
                          className="opacity-0 transition-opacity duration-300 ease-out group-data-[diff-panel-state=open]/changes-trigger:opacity-[0.22]"
                        />
                        <rect x="3" y="5" width="18" height="14" rx="2.5" />
                        <line x1="9" y1="5" x2="9" y2="19" />
                      </svg>
                      {diffCount > 0 ? (
                        <span className="absolute right-1.5 top-1.5 min-w-3.5 rounded-full bg-primary px-1 text-center font-mono text-[8px] leading-3 text-primary-foreground ring-1 ring-background group-data-[diff-panel-state=open]/changes-trigger:bg-primary-foreground group-data-[diff-panel-state=open]/changes-trigger:text-primary">
                          {diffCount > 99 ? "99+" : diffCount}
                        </span>
                      ) : null}
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
                  initialModel={initialModel}
                  initialReasoningEffort={initialReasoningEffort}
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
