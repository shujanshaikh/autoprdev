"use client";

import { useChat } from "@ai-sdk/react";
import { api } from "@autopr/backend/convex/_generated/api";
import { Button } from "@autopr/ui/components/button";
import { cn } from "@autopr/ui/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@autopr/ui/components/dialog";
import { SidebarTrigger } from "@autopr/ui/components/sidebar";
import { WorkflowChatTransport } from "@workflow/ai";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { parsePatch } from "diff";
import {
  getToolName,
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
  type PrepareReconnectToStreamRequest,
  type UIMessage,
} from "ai";
import {
  Bot,
  ChevronDown,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Trash2,
} from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput, ExploreToolRow, isExploreTool, isToolDiffPayload, toolSlugFromPart, type ToolDiffPayload, type ToolPart } from "@/components/ai-elements/tool";
import { toUIMessage } from "@/lib/chat-messages";
import { ModeToggle } from "@/components/mode-toggle";
import Loader from "@/components/loader";
import { ThreadDiffPanel } from "./_components/thread-diff-panel";
import type { ThreadDiffEntry } from "./components/thread-diff-panel-utils";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isContentDetailsOutput(
  v: unknown
): v is { content: string; details: Record<string, unknown> } {
  return isRecord(v) && typeof v.content === "string" && isRecord(v.details);
}

function countPatchLines(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  try {
    for (const parsedPatch of parsePatch(patch)) {
      for (const hunk of parsedPatch.hunks) {
        for (const line of hunk.lines) {
          if (line.startsWith("+")) {
            additions += 1;
          } else if (line.startsWith("-")) {
            deletions += 1;
          }
        }
      }
    }
  } catch {
    for (const line of patch.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        additions += 1;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deletions += 1;
      }
    }
  }

  return { additions, deletions };
}

function diffStatus(diff: ToolDiffPayload): ThreadDiffEntry["status"] {
  if (diff.oldContent === null || diff.oldContent === "") {
    return "added";
  }
  if (diff.newContent === "") {
    return "deleted";
  }
  return "modified";
}

function extractThreadDiffEntries(messages: UIMessage[]): ThreadDiffEntry[] {
  const entries: ThreadDiffEntry[] = [];
  const fileTurns = new Map<string, number>();

  for (const message of messages) {
    for (let index = 0; index < message.parts.length; index += 1) {
      const part = message.parts[index];
      if (!part || !isToolUIPart(part)) {
        continue;
      }

      const slug = toolSlugFromPart(
        part.type,
        part.type === "dynamic-tool" ? getToolName(part) : undefined,
      );
      if (slug !== "edit" && slug !== "write") {
        continue;
      }

      const output = "output" in part ? part.output : undefined;
      if (!isContentDetailsOutput(output) || !isToolDiffPayload(output.details.diff)) {
        continue;
      }

      const diff = output.details.diff;
      const patch = typeof diff.patch === "string" ? diff.patch : "";
      const file =
        typeof output.details.path === "string"
          ? output.details.path
          : diff.fileName ?? "Changed file";
      const { additions, deletions } = countPatchLines(patch);
      const turn = (fileTurns.get(file) ?? 0) + 1;
      fileTurns.set(file, turn);

      entries.push({
        id: `${message.id}:${index}`,
        messageId: message.id,
        partIndex: index,
        turn,
        tool: slug,
        file,
        patch,
        additions,
        deletions,
        status: diffStatus(diff),
        oldContent: diff.oldContent,
        newContent: diff.newContent,
        diff,
      });
    }
  }

  return entries;
}

function getPartState(part: object) {
  return "state" in part ? part.state : undefined;
}

function getToolState(part: object): ToolPart["state"] {
  const state = getPartState(part);
  if (
    state === "approval-requested" ||
    state === "approval-responded" ||
    state === "input-available" ||
    state === "input-streaming" ||
    state === "output-available" ||
    state === "output-denied" ||
    state === "output-error"
  ) {
    return state;
  }

  return "output-available";
}


function ExploreToolGroup({
  messageId,
  tools,
  summaryParts,
  anyStreaming,
}: {
  messageId: string;
  tools: { part: any; index: number }[];
  summaryParts: string[];
  anyStreaming: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="my-1.5 w-full min-w-0 font-mono text-[11px] leading-tight text-muted-foreground/50">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="group/explore flex w-full cursor-pointer items-center gap-1.5 py-0.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <ChevronDown
          className={`size-3 shrink-0 text-muted-foreground/40 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
        />
        <span className="font-medium text-muted-foreground/70">{anyStreaming ? "Exploring" : "Explored"}</span>
        <span className="text-muted-foreground/40">
          {summaryParts.join(", ")}
        </span>
        {anyStreaming ? (
          <span className="ml-auto size-1.5 animate-pulse rounded-full bg-primary/60" />
        ) : null}
      </button>
      {isOpen ? (
        <div className="ml-4 border-l border-border/20 pl-2.5">
          {tools.map((t) => {
            const partState = getToolState(t.part);
            const input = "input" in t.part ? t.part.input : undefined;
            return (
              <ExploreToolRow
                key={`${messageId}-explore-row-${t.index}`}
                type={t.part.type}
                toolName={t.part.type === "dynamic-tool" ? getToolName(t.part) : undefined}
                input={input}
                state={partState}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ThreadHandoffPreview({ prompt }: { prompt: string }) {
  return (
    <div className="message-enter-user">
      <div className="mx-auto max-w-[680px] px-6 py-4 sm:px-8">
        <div className="rounded-lg bg-muted p-4">
          <p className="text-[15px] leading-[1.7] text-foreground">{prompt}</p>
        </div>
      </div>
    </div>
  );
}

function AwaitingAgentIndicator() {
  return (
    <div role="status" aria-live="polite" aria-label="Agent is thinking">
      <div className="mx-auto max-w-[680px] px-6 py-2 sm:px-8">
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/55 [animation-delay:-0.2s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/55 [animation-delay:-0.1s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/55" />
        </div>
      </div>
    </div>
  );
}

function ThreadChat({
  projectId,
  threadId,
  currentRunId,
  initialMessages,
  initialPrompt,
  disabled,
  diffPanelOpen,
  onDiffPanelOpenChange,
  onDiffCountChange,
}: {
  projectId: string;
  threadId: string;
  currentRunId?: string;
  initialMessages: UIMessage[];
  initialPrompt?: string;
  disabled: boolean;
  diffPanelOpen: boolean;
  onDiffPanelOpenChange: (open: boolean) => void;
  onDiffCountChange: (count: number) => void;
}) {
  const activeRunIdRef = useRef(currentRunId);
  const resumedRunIdsRef = useRef(new Set<string>());
  const hasAutoSubmittedInitialPromptRef = useRef(false);
  const [selectedDiffEntryId, setSelectedDiffEntryId] = useState<string | undefined>();

  useEffect(() => {
    if (currentRunId) {
      activeRunIdRef.current = currentRunId;
    }
  }, [currentRunId]);

  const agentApi = useMemo(
    () => `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}/agent`,
    [projectId, threadId],
  );

  const getRunStreamApi = useCallback(
    (runId: string) => `${agentApi}/${encodeURIComponent(runId)}/stream`,
    [agentApi],
  );

  const handleChatSendMessage = useCallback((response: Response) => {
    const workflowRunId = response.headers.get("x-workflow-run-id");
    if (workflowRunId) {
      activeRunIdRef.current = workflowRunId;
      resumedRunIdsRef.current.add(workflowRunId);
    }
  }, []);

  const handleChatEnd = useCallback(() => {
    activeRunIdRef.current = undefined;
  }, []);

  const prepareReconnectToStreamRequest = useCallback<PrepareReconnectToStreamRequest>(
    (options) => {
      const runId = activeRunIdRef.current;

      if (!runId) {
        throw new Error("No active workflow run ID found");
      }

      return {
        ...options,
        api: getRunStreamApi(runId),
      };
    },
    [getRunStreamApi],
  );

  const transport = useMemo(
    () =>
      new WorkflowChatTransport<UIMessage>({
        api: agentApi,
        onChatSendMessage: handleChatSendMessage,
        onChatEnd: handleChatEnd,
        prepareSendMessagesRequest: (options) => ({
          api: options.api,
          body: {
            message: options.messages[options.messages.length - 1],
          },
          headers: options.headers,
          credentials: options.credentials,
        }),
        prepareReconnectToStreamRequest,
      }),
    [agentApi, handleChatEnd, handleChatSendMessage, prepareReconnectToStreamRequest],
  );

  const { messages, sendMessage, resumeStream, status, stop, error, clearError } = useChat<UIMessage>({
    id: threadId,
    messages: initialMessages,
    transport,
  });
  const diffEntries = useMemo(() => extractThreadDiffEntries(messages), [messages]);

  useEffect(() => {
    onDiffCountChange(diffEntries.length);
  }, [diffEntries.length, onDiffCountChange]);

  useEffect(() => {
    if (diffEntries.length === 0) {
      setSelectedDiffEntryId(undefined);
      return;
    }

    if (selectedDiffEntryId && diffEntries.some((entry) => entry.id === selectedDiffEntryId)) {
      return;
    }

    setSelectedDiffEntryId(diffEntries.at(-1)?.id);
  }, [diffEntries, selectedDiffEntryId]);

  useEffect(() => {
    if (!currentRunId || status !== "ready" || resumedRunIdsRef.current.has(currentRunId)) {
      return;
    }

    resumedRunIdsRef.current.add(currentRunId);
    void resumeStream();
  }, [currentRunId, resumeStream, status]);

  const busy = status === "submitted" || status === "streaming";
  const ready = status === "ready" && !disabled;
  const showingInitialPromptHandoff = Boolean(initialPrompt && messages.length === 0);
  const awaitingAgentResponse = status === "submitted";

  const submitMessage = useCallback(async (text: string) => {
    const nextMessage = text.trim();
    if (!nextMessage || !ready) {
      return;
    }

    clearError();
    await sendMessage({ text: nextMessage });
  }, [clearError, ready, sendMessage]);

  useEffect(() => {
    if (!initialPrompt || hasAutoSubmittedInitialPromptRef.current || !ready) {
      return;
    }

    if (messages.length > 0) {
      hasAutoSubmittedInitialPromptRef.current = true;
      return;
    }

    hasAutoSubmittedInitialPromptRef.current = true;
    void submitMessage(initialPrompt);
  }, [initialPrompt, messages.length, ready, submitMessage]);

  return (
    <section className="grid h-full min-h-0 w-full min-w-0 flex-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
        <div className="relative min-h-0 min-w-0 overflow-hidden">
          <Conversation className="minimal-scrollbar h-full min-h-0">
            <ConversationContent>
            {messages.length === 0 && !showingInitialPromptHandoff ? (
              <ConversationEmptyState className="mx-auto max-w-[680px] items-start px-6 py-10 text-left sm:px-8" icon={<Bot className="size-6 text-muted-foreground" />}>
                <div className="max-w-xl">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Repository thread
                  </p>
                  <h2 className="mt-2 text-lg font-semibold leading-snug text-foreground sm:text-xl">
                    Ask the agent to inspect, run, edit, or explain this repository.
                  </h2>
                </div>
                <div className="grid w-full gap-2.5 sm:grid-cols-3">
                  {[
                    "Summarize the repository structure and the likely entry points.",
                    "Run the test or typecheck command you find, then report failures.",
                    "Find the main TODOs or risky areas before we change anything.",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      disabled={!ready}
                      onClick={() => void submitMessage(suggestion)}
                      className="min-h-[72px] rounded-lg border border-border bg-muted p-3.5 text-left text-sm leading-relaxed text-foreground transition hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </ConversationEmptyState>
            ) : null}

            {messages.map((message) => {
              const filteredParts = message.parts.filter(Boolean);
              type GroupedItem =
                | { kind: "single"; part: (typeof filteredParts)[number]; index: number }
                | { kind: "explore-group"; tools: { part: (typeof filteredParts)[number]; index: number }[] };

              const grouped: GroupedItem[] = [];
              for (let i = 0; i < filteredParts.length; i++) {
                const part = filteredParts[i];
                if (
                  isToolUIPart(part) &&
                  isExploreTool(
                    part.type,
                    part.type === "dynamic-tool" ? getToolName(part) : undefined
                  )
                ) {
                  const last = grouped[grouped.length - 1];
                  if (last && last.kind === "explore-group") {
                    last.tools.push({ part, index: i });
                  } else {
                    grouped.push({ kind: "explore-group", tools: [{ part, index: i }] });
                  }
                } else {
                  grouped.push({ kind: "single", part, index: i });
                }
              }

              const isUser = message.role === "user";

              return (
                <div
                  key={message.id}
                >
                  <div className="mx-auto max-w-[680px] px-6 py-4 sm:px-8">
                    <div className={cn(isUser && "rounded-lg bg-muted p-4")}>
                      <MessageContent>
                        {grouped.map((item) => {
                        if (item.kind === "explore-group") {
                          const { tools } = item;
                          const counts: Record<string, number> = {};
                          for (const t of tools) {
                            const slug = toolSlugFromPart(
                              t.part.type,
                              t.part.type === "dynamic-tool" ? getToolName(t.part) : undefined
                            );
                            const label = slug === "find" ? "glob" : slug;
                            counts[label] = (counts[label] ?? 0) + 1;
                          }
                          const summaryParts = Object.entries(counts).map(
                            ([name, count]) => `${count} ${count === 1 ? name : name + "s"}`
                          );
                          const anyStreaming = tools.some((t) => {
                            const s = getToolState(t.part);
                            return s === "input-streaming" || s === "input-available";
                          });

                          return (
                            <ExploreToolGroup
                              key={`${message.id}-explore-${tools[0].index}`}
                              messageId={message.id}
                              tools={tools}
                              summaryParts={summaryParts}
                              anyStreaming={anyStreaming}
                            />
                          );
                        }

                        const { part, index } = item;

                        if (isReasoningUIPart(part)) {
                          const partState = getPartState(part);
                          return (
                            <Reasoning key={`${message.id}-reasoning-${index}`} isStreaming={partState === "streaming"}>
                              <ReasoningTrigger />
                              <ReasoningContent>{part.text}</ReasoningContent>
                            </Reasoning>
                          );
                        }

                        if (isTextUIPart(part)) {
                          const partState = getPartState(part);
                          return (
                            <MessageResponse key={`${message.id}-text-${index}`} isAnimating={partState === "streaming"}>
                              {part.text}
                            </MessageResponse>
                          );
                        }

                        if (isToolUIPart(part)) {
                          const partState = getToolState(part);
                          const input = "input" in part ? part.input : undefined;
                          const output = "output" in part ? part.output : undefined;
                          const errorText = "errorText" in part ? part.errorText : undefined;

                          return (
                            <Tool key={`${message.id}-tool-${index}`} defaultOpen={partState !== "output-available"}>
                              {part.type === "dynamic-tool" ? (
                                <ToolHeader
                                  input={input}
                                  state={partState}
                                  toolName={getToolName(part)}
                                  type={part.type}
                                />
                              ) : (
                                <ToolHeader input={input} state={partState} type={part.type} />
                              )}
                              <ToolContent>
                                {input !== undefined ? (
                                  <ToolInput
                                    input={input}
                                    toolName={part.type === "dynamic-tool" ? getToolName(part) : undefined}
                                    toolType={part.type}
                                  />
                                ) : null}
                                <ToolOutput
                                  errorText={errorText}
                                  output={output}
                                  toolName={part.type === "dynamic-tool" ? getToolName(part) : undefined}
                                  toolType={part.type}
                                />
                              </ToolContent>
                            </Tool>
                          );
                        }

                        if (part.type === "step-start") {
                          return null;
                        }

                        return (
                          <div
                            key={`${message.id}-part-${index}`}
                            className="rounded-md border border-dashed border-border/50 px-3 py-2 font-mono text-xs text-muted-foreground"
                          >
                            {part.type}
                          </div>
                        );
                      })}
                      </MessageContent>
                    </div>
                  </div>
                </div>
              );
            })}

            {error ? (
              <div role="alert">
                <div className="mx-auto max-w-[680px] px-6 py-4 sm:px-8">
                  <p className="text-[13px] font-medium text-destructive">{error.message}</p>
                </div>
              </div>
            ) : null}

            {showingInitialPromptHandoff ? <ThreadHandoffPreview prompt={initialPrompt!} /> : null}
            {awaitingAgentResponse ? <AwaitingAgentIndicator /> : null}
            </ConversationContent>
            <div className="h-8" />
            <ConversationScrollButton className="bottom-4" />
          </Conversation>
        </div>

        <div className="relative bg-background px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 sm:px-8">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-border" />
          <div className="mx-auto max-w-[680px]">
            {currentRunId ? (
              <p className="mb-3 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Run {currentRunId}
              </p>
            ) : null}
            <PromptInput
              className="rounded-xl border border-border bg-muted shadow-sm transition-all focus-within:border-primary/40 focus-within:shadow-md focus-within:ring-1 focus-within:ring-primary/10"
              onSubmit={(message) => void submitMessage(message.text)}
            >
              <PromptInputBody>
                <PromptInputTextarea disabled={!ready} placeholder="Message this thread..." />
              </PromptInputBody>
              <PromptInputFooter>
                <PromptInputTools>
                </PromptInputTools>
                <PromptInputSubmit disabled={!ready && !busy} onStop={() => void stop()} status={status} />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      </div>
      <ThreadDiffPanel
        entries={diffEntries}
        selectedEntryId={selectedDiffEntryId}
        onSelectEntry={setSelectedDiffEntryId}
        open={diffPanelOpen}
        onOpenChange={onDiffPanelOpenChange}
        isLoading={status === "submitted" || status === "streaming"}
      />
    </section>
  );
}

export default function ProjectThreadPage() {
  const params = useParams<{ projectId: string; threadId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated } = useConvexAuth();
  const projectId = params.projectId;
  const threadId = params.threadId;
  const initialPrompt = searchParams.get("prompt")?.trim() || undefined;
  const removeThread = useMutation(api.threads.remove);
  const project = useQuery(api.projects.get, isAuthenticated ? { projectId } : "skip");
  const thread = useQuery(api.threads.get, isAuthenticated ? { threadId } : "skip");
  const dbMessages = useQuery(api.messages.listByThread, isAuthenticated ? { threadId } : "skip");
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const [diffPanelOpen, setDiffPanelOpen] = useState(false);
  const [diffCount, setDiffCount] = useState(0);

  const initialMessages = useMemo(() => dbMessages?.map(toUIMessage) ?? [], [dbMessages]);
  const isPromptHandoff = Boolean(initialPrompt);
  const loading = project === undefined || thread === undefined || dbMessages === undefined;
  const handoffLoading = isPromptHandoff && (project === undefined || thread === undefined || dbMessages === undefined);
  const notFound = !loading && (!project || !thread || thread.projectId !== projectId);
  const disabled = !project || project.sandboxStatus !== "ready";

  useEffect(() => {
    setDiffCount(0);
    setDiffPanelOpen(false);
  }, [threadId]);

  const handleDeleteThread = useCallback(async () => {
    setIsDeleting(true);
    setDeleteError(undefined);
    try {
      await removeThread({ threadId });
      setIsDeleteOpen(false);
      router.replace(`/project/${projectId}`);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete this thread.");
    } finally {
      setIsDeleting(false);
    }
  }, [projectId, removeThread, router, threadId]);

  const handleDiffCountChange = useCallback((count: number) => {
    setDiffCount(count);
    if (count === 0) {
      setDiffPanelOpen(false);
    }
  }, []);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <header className="relative z-10 flex h-12 shrink-0 items-center border-b border-border/70 bg-background/95 px-3 backdrop-blur sm:px-4">
              <SidebarTrigger className="mr-2" />

              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="hidden max-w-[220px] truncate font-mono text-xs text-muted-foreground sm:inline">
                  {project?.repoFullName ?? "Repository"}
                </span>
                <span className="hidden text-muted-foreground sm:inline">/</span>
                <h1 className="min-w-0 truncate text-sm font-semibold">
                  {thread?.title ?? initialPrompt ?? "Loading thread"}
                </h1>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant={diffPanelOpen ? "secondary" : "ghost"}
                  size="icon"
                  aria-controls="thread-changes-panel"
                  aria-expanded={diffPanelOpen}
                  title={diffPanelOpen ? "Hide diff" : "Show diff"}
                  onClick={() => setDiffPanelOpen((open) => !open)}
                  className="relative size-8 shrink-0"
                >
                  {diffPanelOpen ? (
                    <PanelRightClose className="size-4" aria-hidden="true" />
                  ) : (
                    <PanelRightOpen className="size-4" aria-hidden="true" />
                  )}
                  <span className="sr-only">{diffPanelOpen ? "Hide diff" : "Show diff"}</span>
                  {diffCount > 0 ? (
                    <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center bg-foreground px-1 font-mono text-[9px] font-semibold leading-4 text-background">
                      {diffCount > 99 ? "99+" : diffCount}
                    </span>
                  ) : null}
                </Button>
                <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
                  <DialogTrigger
                    render={
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={loading || notFound || isDeleting}
                        className="h-9 border border-destructive/30 bg-destructive/10 px-2.5 font-mono text-[11px]"
                      />
                    }
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    Delete
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Delete thread?</DialogTitle>
                      <DialogDescription>
                        This permanently deletes <span className="font-semibold text-foreground">{thread?.title ?? "this thread"}</span> and all of its messages.
                      </DialogDescription>
                    </DialogHeader>
                    {deleteError ? (
                      <p className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {deleteError}
                      </p>
                    ) : null}
                    <DialogFooter>
                      <Button variant="outline" disabled={isDeleting} onClick={() => setIsDeleteOpen(false)}>
                        Cancel
                      </Button>
                      <Button variant="destructive" disabled={isDeleting} onClick={() => void handleDeleteThread()}>
                        {isDeleting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                        Delete thread
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <div className="inline-flex h-9 items-center gap-2 border border-primary/20 bg-primary/6 px-3 font-mono text-[11px] text-muted-foreground dark:bg-primary/8">
                  <span
                    className={`size-2 shrink-0 border border-foreground/80 ${thread?.isLive ? "bg-primary shadow-[0_0_0_3px_rgba(var(--primary),0.25)]" : "bg-background"
                      }`}
                  />
                  {thread?.isLive ? "Streaming" : project?.sandboxStatus ?? "Loading"}
                </div>
                <ModeToggle />
              </div>
            </header>

            <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              {notFound ? (
                <div className="border border-border p-5 text-sm text-muted-foreground">Thread not found.</div>
              ) : loading && !handoffLoading ? (
                <section className="min-h-0 w-full min-w-0 flex-1">
                  <Loader />
                </section>
              ) : (
                <ThreadChat
                  key={threadId}
                  projectId={projectId}
                  threadId={threadId}
                  currentRunId={thread?.currentRunId}
                  initialMessages={handoffLoading ? [] : initialMessages}
                  initialPrompt={initialPrompt}
                  disabled={disabled}
                  diffPanelOpen={diffPanelOpen}
                  onDiffPanelOpenChange={setDiffPanelOpen}
                  onDiffCountChange={handleDiffCountChange}
                />
              )}
            </main>
          </div>
  );
}
