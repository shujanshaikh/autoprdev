import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { api } from "@autopr/backend/convex/_generated/api";
import { cn } from "@autopr/ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@autopr/ui/components/tooltip";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { Suspense, useCallback, useEffect, useMemo, useReducer, useState } from "react";

import { PierreDiffWorkerPoolProvider } from "@/components/ai-elements/pierre-diff-view";
import Loader from "@/components/loader";
import { toUIMessage, type StoredMessageRow } from "@/lib/chat-messages";
import { ThreadChat } from "#/components/thread/thread-chat";
import { ThreadCommitButton } from "#/components/thread/thread-commit-button";
import { isCodexModelId, isCodexReasoningEffortForModel } from "#/lib/codex-models";

const EMPTY_STORED_MESSAGES: StoredMessageRow[] = [];
const EMPTY_PARTS_CACHE: Record<string, StoredMessageRow["parts"]> = {};

type AssistantBlobDescriptor = {
  messageId: string;
  partsR2Key: string;
  partsBlobSizeBytes?: number;
  partsBlobSha256?: string;
  cacheKey: string;
};

type HydratedAssistantParts = Omit<AssistantBlobDescriptor, "cacheKey"> & {
  parts: StoredMessageRow["parts"];
};

type MessageLoadState = {
  threadId?: string;
  partsByCacheKey: Record<string, StoredMessageRow["parts"]>;
  messageLoadError: Error | null;
};

type MessageLoadAction =
  | { type: "reset" }
  | { type: "clearError" }
  | { type: "loaded"; threadId: string; parts: HydratedAssistantParts[] }
  | { type: "failed"; error: Error };

const INITIAL_MESSAGE_LOAD_STATE: MessageLoadState = {
  threadId: undefined,
  partsByCacheKey: EMPTY_PARTS_CACHE,
  messageLoadError: null,
};

function messageLoadReducer(state: MessageLoadState, action: MessageLoadAction): MessageLoadState {
  switch (action.type) {
    case "reset":
      if (
        state.threadId === undefined &&
        state.partsByCacheKey === EMPTY_PARTS_CACHE &&
        state.messageLoadError === null
      ) {
        return state;
      }
      return INITIAL_MESSAGE_LOAD_STATE;
    case "clearError":
      if (state.messageLoadError === null) {
        return state;
      }
      return { ...state, messageLoadError: null };
    case "loaded":
      return {
        threadId: action.threadId,
        partsByCacheKey: action.parts.reduce<Record<string, StoredMessageRow["parts"]>>((cache, result) => {
          cache[assistantBlobCacheKey(result)] = result.parts;
          return cache;
        }, state.threadId === action.threadId ? { ...state.partsByCacheKey } : {}),
        messageLoadError: null,
      };
    case "failed":
      return { ...state, messageLoadError: action.error };
  }
}

function assistantBlobCacheKey(blob: {
  partsR2Key: string;
  partsBlobSizeBytes?: number;
  partsBlobSha256?: string;
}) {
  return JSON.stringify([
    blob.partsR2Key,
    blob.partsBlobSizeBytes ?? null,
    blob.partsBlobSha256 ?? null,
  ]);
}

function assistantBlobDescriptor(message: StoredMessageRow): AssistantBlobDescriptor | null {
  if (message.role !== "assistant" || !message.partsR2Key) {
    return null;
  }

  return {
    messageId: message.messageId,
    partsR2Key: message.partsR2Key,
    partsBlobSizeBytes: message.partsBlobSizeBytes,
    partsBlobSha256: message.partsBlobSha256,
    cacheKey: assistantBlobCacheKey({
      partsR2Key: message.partsR2Key,
      partsBlobSizeBytes: message.partsBlobSizeBytes,
      partsBlobSha256: message.partsBlobSha256,
    }),
  };
}

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
  const dbMessages = useQuery(api.messages.listByThread, isAuthenticated ? { threadId } : "skip");
  const hydrateAssistantParts = useAction(api.messages.hydrateAssistantParts);
  const userSettings = useQuery(api.userSettings.get, isAuthenticated ? {} : "skip");
  const [diffPanelOpen, setDiffPanelOpen] = useState(false);
  const [diffCount, setDiffCount] = useState(0);
  const [{ threadId: hydratedThreadId, partsByCacheKey, messageLoadError }, dispatchMessageLoad] = useReducer(
    messageLoadReducer,
    INITIAL_MESSAGE_LOAD_STATE,
  );

  const activePartsCache = hydratedThreadId === threadId ? partsByCacheKey : EMPTY_PARTS_CACHE;
  const assistantBlobDescriptors = useMemo(
    () => dbMessages?.map(assistantBlobDescriptor).filter((descriptor): descriptor is AssistantBlobDescriptor =>
      descriptor !== null,
    ) ?? [],
    [dbMessages],
  );
  const missingAssistantBlobDescriptors = useMemo(
    () => assistantBlobDescriptors.filter((descriptor) => activePartsCache[descriptor.cacheKey] === undefined),
    [activePartsCache, assistantBlobDescriptors],
  );
  const effectiveDbMessages = useMemo(() => {
    if (dbMessages === undefined) {
      return undefined;
    }

    if (dbMessages.length === 0) {
      return EMPTY_STORED_MESSAGES;
    }

    if (missingAssistantBlobDescriptors.length > 0) {
      return undefined;
    }

    return dbMessages.map((message: StoredMessageRow) => {
      const descriptor = assistantBlobDescriptor(message);

      if (!descriptor) {
        return message;
      }

      return {
        ...message,
        parts: activePartsCache[descriptor.cacheKey] ?? message.parts,
      };
    });
  }, [activePartsCache, dbMessages, missingAssistantBlobDescriptors.length]);
  const initialMessages = useMemo(() => effectiveDbMessages?.map(toUIMessage) ?? [], [effectiveDbMessages]);
  const shouldAutoSubmitInitialPrompt = Boolean(
    initialPrompt &&
    dbMessages &&
    dbMessages.length === 0,
  );
  const loading =
    project === undefined ||
    thread === undefined ||
    dbMessages === undefined ||
    (effectiveDbMessages === undefined && !messageLoadError);
  const messageLoadFailed = Boolean(messageLoadError && effectiveDbMessages === undefined);
  const notFound = !loading && (!project || !thread || thread.projectId !== projectId);
  const disabled = !project || project.sandboxStatus !== "ready";
  const demoRecordingExperimentEnabled = Boolean(userSettings?.demoRecordingExperimentEnabled);

  useEffect(() => {
    if (!isAuthenticated || dbMessages === undefined) {
      dispatchMessageLoad({ type: "reset" });
      return;
    }

    if (dbMessages.length === 0 || missingAssistantBlobDescriptors.length === 0) {
      dispatchMessageLoad({ type: "clearError" });
      return;
    }

    let cancelled = false;
    dispatchMessageLoad({ type: "clearError" });

    void hydrateAssistantParts({
      threadId,
      blobs: missingAssistantBlobDescriptors.map(({ cacheKey, ...descriptor }) => descriptor),
    })
      .then((parts) => {
        if (cancelled) {
          return;
        }

        dispatchMessageLoad({
          type: "loaded",
          threadId,
          parts,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        console.error("Failed to load thread messages", error);
        dispatchMessageLoad({
          type: "failed",
          error: error instanceof Error ? error : new Error("Could not load thread messages."),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    dbMessages,
    hydrateAssistantParts,
    isAuthenticated,
    missingAssistantBlobDescriptors,
    threadId,
  ]);

  useEffect(() => {
    setDiffCount(0);
    setDiffPanelOpen(false);
  }, [threadId]);

  const handleDiffCountChange = useCallback((count: number) => {
    setDiffCount(count);
  }, []);

  const handleInitialPromptConsumed = useCallback(() => {
    navigate({
      to: ".",
      search: (prev) => ({ ...prev, prompt: undefined, model: undefined, reasoningEffort: undefined }),
      replace: true,
      resetScroll: false,
    });
  }, [navigate]);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <header className="relative z-10 flex h-11 shrink-0 items-stretch border-b border-border bg-background">
              <div className="min-w-0 flex-1" />

              <ThreadCommitButton
                projectId={projectId}
                threadId={threadId}
                disabled={disabled || loading || notFound}
                thread={thread}
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
              ) : messageLoadFailed ? (
                <div className="border border-border p-5 text-sm text-muted-foreground">
                  Could not load thread messages.
                </div>
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
                  demoRecordingExperimentEnabled={demoRecordingExperimentEnabled}
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
