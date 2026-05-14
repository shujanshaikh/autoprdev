"use client";

import { useChat } from "@ai-sdk/react";
import { api } from "@autopr/backend/convex/_generated/api";
import { Button } from "@autopr/ui/components/button";
import { cn } from "@autopr/ui/lib/utils";
import { SidebarTrigger } from "@autopr/ui/components/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@autopr/ui/components/tooltip";
import { WorkflowChatTransport } from "@workflow/ai";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
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
} from "lucide-react";
import type { Route } from "next";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { PierreDiffWorkerPoolProvider } from "@/components/ai-elements/pierre-diff-view";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput, ExploreToolRow, isExploreTool, isToolDiffPayload, toolSlugFromPart, type ToolDiffPayload, type ToolPart } from "@/components/ai-elements/tool";
import { toUIMessage } from "@/lib/chat-messages";
import Loader from "@/components/loader";
import { ThreadDiffPanel } from "./components/thread-diff-panel";
import type { ThreadDiffEntry } from "./components/thread-diff-panel-utils";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isExpectedStreamAbort(error: unknown) {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.includes("BodyStreamBuffer was aborted"))
  );
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
  tools: { part: any; stableKey: string }[];
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
                key={`${messageId}-explore-row-${t.stableKey}`}
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
        <div className="rounded-none border border-border bg-card p-4 shadow-sm">
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
          <span className="size-1.5 rounded-full bg-muted-foreground/55 motion-safe:animate-[pulse_1s_cubic-bezier(0.16,1,0.3,1)_infinite] [animation-delay:-0.2s]" />
          <span className="size-1.5 rounded-full bg-muted-foreground/55 motion-safe:animate-[pulse_1s_cubic-bezier(0.16,1,0.3,1)_infinite] [animation-delay:-0.1s]" />
          <span className="size-1.5 rounded-full bg-muted-foreground/55 motion-safe:animate-[pulse_1s_cubic-bezier(0.16,1,0.3,1)_infinite]" />
        </div>
      </div>
    </div>
  );
}

function SandboxStatusBar({
  sandboxStatus,
  runtimeStatus,
  checking = false,
}: {
  sandboxStatus?: "creating" | "ready" | "failed";
  runtimeStatus?: "started" | "stopped" | "unknown";
  checking?: boolean;
}) {
  const vmLabel = sandboxStatus === "ready" ? runtimeStatus ?? "unknown" : sandboxStatus ?? "unknown";
  const barClass =
    sandboxStatus === "failed"
      ? "bg-destructive"
      : sandboxStatus === "creating" || checking
        ? "bg-amber-500"
        : runtimeStatus === "started"
          ? "bg-emerald-500"
          : runtimeStatus === "stopped"
            ? "bg-zinc-500"
            : "bg-muted-foreground/60";

  return (
    <div className="-mt-px flex h-6 items-center justify-end border border-t-0 border-border bg-card/70 px-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
      <span className="mr-2 relative inline-flex h-2 w-5 shrink-0 items-end rounded-full bg-muted">
        <span className={cn("h-0.5 w-full rounded-full", barClass, checking && "animate-pulse")} aria-hidden="true" />
      </span>
      <span className="shrink-0 tabular-nums">vm {checking ? "checking" : vmLabel}</span>
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
  onInitialPromptConsumed,
  project,
  thread,
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
  onInitialPromptConsumed?: () => void;
  project?: any;
  thread?: any;
}) {
  const activeRunIdRef = useRef(currentRunId);
  const resumedRunIdsRef = useRef(new Set<string>());
  const hasAutoSubmittedInitialPromptRef = useRef(false);
  const pendingStopRef = useRef<Promise<void> | null>(null);
  const [selectedDiffEntryId, setSelectedDiffEntryId] = useState<string | undefined>();
  const [runtimeStatus, setRuntimeStatus] = useState<"started" | "stopped" | "unknown" | undefined>(
    project?.sandboxRuntimeStatus,
  );
  const [runtimeStatusLoading, setRuntimeStatusLoading] = useState(false);
  const getSandboxRuntimeStatus = useAction(api.projectActions.getSandboxRuntimeStatus);

  useEffect(() => {
    if (currentRunId) {
      activeRunIdRef.current = currentRunId;
    }
  }, [currentRunId]);

  useEffect(() => {
    setRuntimeStatus(project?.sandboxRuntimeStatus);
  }, [project?.sandboxRuntimeStatus]);

  useEffect(() => {
    if (project?.sandboxStatus !== "ready") return;
    let cancelled = false;
    setRuntimeStatusLoading(true);

    void getSandboxRuntimeStatus({ projectId })
      .then((result) => {
        if (!cancelled) setRuntimeStatus(result.status);
      })
      .catch(() => {
        if (!cancelled) setRuntimeStatus("unknown");
      })
      .finally(() => {
        if (!cancelled) setRuntimeStatusLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [getSandboxRuntimeStatus, project?.sandboxStatus, projectId]);

  const agentApi = `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}/agent`;

  const getRunStreamApi = useCallback(
    (runId: string) => `${agentApi}/${encodeURIComponent(runId)}/stream`,
    [agentApi],
  );

  const getRunApi = useCallback(
    (runId: string) => `${agentApi}/${encodeURIComponent(runId)}`,
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
    onError: (chatError) => {
      if (!isExpectedStreamAbort(chatError)) {
        throw chatError;
      }
    },
  });
  const lastMessage = messages.at(-1);
  const hasPersistedLastAssistantMessage = lastMessage?.role === "assistant" && lastMessage.parts.length > 0;
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

    // AI SDK streams append to the current assistant message when resuming.
    // If the last assistant message already has persisted parts, replaying the
    // workflow stream from index 0 would duplicate that content in the UI.
    if (hasPersistedLastAssistantMessage) {
      activeRunIdRef.current = undefined;
      return;
    }

    void resumeStream();
  }, [currentRunId, hasPersistedLastAssistantMessage, resumeStream, status]);

  const busy = status === "submitted" || status === "streaming";
  const ready = status === "ready" && !disabled;
  const stopGeneration = useCallback(() => {
    const runId = activeRunIdRef.current;
    const assistantMessage = messages.findLast((message) => message.role === "assistant");

    try {
      stop();
    } catch (stopError) {
      if (!isExpectedStreamAbort(stopError)) {
        throw stopError;
      }
    }

    clearError();

    if (!runId) {
      return;
    }

    activeRunIdRef.current = undefined;

    const stopPromise = fetch(getRunApi(runId), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assistantMessage: assistantMessage
          ? {
              id: assistantMessage.id,
              parts: assistantMessage.parts,
              metadata: assistantMessage.metadata,
            }
          : undefined,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to cancel workflow run: ${response.status}`);
        }
      })
      .catch((cancelError) => {
        console.error("Failed to cancel workflow run", cancelError);
      })
      .finally(() => {
        if (pendingStopRef.current === stopPromise) {
          pendingStopRef.current = null;
        }
      });

    pendingStopRef.current = stopPromise;
  }, [clearError, getRunApi, messages, stop]);
  const showingInitialPromptHandoff = Boolean(initialPrompt && messages.length === 0);
  const awaitingAgentResponse = status === "submitted";
  const keyedMessages = useMemo(() => {
    const keyCounts = new Map<string, number>();

    return messages.map((message) => {
      const count = keyCounts.get(message.id) ?? 0;
      keyCounts.set(message.id, count + 1);

      return {
        message,
        messageKey: count === 0 ? message.id : `${message.id}-${count}`,
      };
    });
  }, [messages]);

  const submitMessage = useCallback(async (text: string) => {
    const nextMessage = text.trim();
    if (!nextMessage || disabled) {
      return;
    }

    if (pendingStopRef.current) {
      await pendingStopRef.current;
    }

    if (status !== "ready") {
      return;
    }

    clearError();
    await sendMessage({ text: nextMessage });
  }, [clearError, disabled, sendMessage, status]);

  useEffect(() => {
    if (!initialPrompt || hasAutoSubmittedInitialPromptRef.current || !ready) {
      return;
    }

    if (messages.length > 0) {
      hasAutoSubmittedInitialPromptRef.current = true;
      return;
    }

    const handoffKey = `thread-prompt-handoff:${threadId}:${initialPrompt}`;
    if (sessionStorage.getItem(handoffKey) === "submitted") {
      hasAutoSubmittedInitialPromptRef.current = true;
      return;
    }

    hasAutoSubmittedInitialPromptRef.current = true;
    sessionStorage.setItem(handoffKey, "submitted");
    onInitialPromptConsumed?.();
    void submitMessage(initialPrompt);
  }, [initialPrompt, messages.length, onInitialPromptConsumed, ready, submitMessage, threadId]);

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

            {keyedMessages.map(({ message, messageKey }) => {
              const filteredParts = message.parts.filter(Boolean);
              type GroupedItem =
                | { kind: "single"; part: (typeof filteredParts)[number]; stableKey: string }
                | { kind: "explore-group"; tools: { part: (typeof filteredParts)[number]; stableKey: string }[] };

              const grouped: GroupedItem[] = [];
              const partKeyCounts = new Map<string, number>();
              for (const part of filteredParts) {
                const keyBase = isToolUIPart(part)
                  ? `${part.type}-${part.type === "dynamic-tool" ? getToolName(part) : "tool"}-${"toolCallId" in part ? part.toolCallId : "pending"}`
                  : isTextUIPart(part)
                    ? `text-${part.text.slice(0, 32)}`
                    : isReasoningUIPart(part)
                      ? `reasoning-${part.text.slice(0, 32)}`
                      : part.type;
                const keyCount = partKeyCounts.get(keyBase) ?? 0;
                partKeyCounts.set(keyBase, keyCount + 1);
                const stableKey = `${keyBase}-${keyCount}`;
                if (
                  isToolUIPart(part) &&
                  isExploreTool(
                    part.type,
                    part.type === "dynamic-tool" ? getToolName(part) : undefined
                  )
                ) {
                  const last = grouped[grouped.length - 1];
                  if (last && last.kind === "explore-group") {
                    last.tools.push({ part, stableKey });
                  } else {
                    grouped.push({ kind: "explore-group", tools: [{ part, stableKey }] });
                  }
                } else {
                  grouped.push({ kind: "single", part, stableKey });
                }
              }

              const isUser = message.role === "user";

              return (
                <div key={messageKey}>
                  <div className="mx-auto max-w-[680px] px-6 py-4 sm:px-8">
                    <div className={cn(isUser && "rounded-none border border-border bg-card p-4 shadow-sm")}>
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
                              key={`${message.id}-explore-${tools[0].stableKey}`}
                              messageId={message.id}
                              tools={tools}
                              summaryParts={summaryParts}
                              anyStreaming={anyStreaming}
                            />
                          );
                        }

                        const { part, stableKey } = item;

                        if (isReasoningUIPart(part)) {
                          const partState = getPartState(part);
                          return (
                            <Reasoning key={`${message.id}-reasoning-${stableKey}`} isStreaming={partState === "streaming"}>
                              <ReasoningTrigger />
                              <ReasoningContent>{part.text}</ReasoningContent>
                            </Reasoning>
                          );
                        }

                        if (isTextUIPart(part)) {
                          const partState = getPartState(part);
                          return (
                            <MessageResponse key={`${message.id}-text-${stableKey}`} isAnimating={partState === "streaming"}>
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
                            <Tool key={`${message.id}-tool-${stableKey}`} defaultOpen={partState !== "output-available"}>
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
                            key={`${message.id}-part-${stableKey}`}
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

        <div className="relative bg-background px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:px-8">
          <div className="mx-auto max-w-[680px]">
            <PromptInput
              className={cn(
                // Sharp, flat, matches dashboard panels (border-border + bg-card)
                "border border-border bg-card shadow-none transition-colors",
                "focus-within:border-primary/60",
              )}
              onSubmit={(message) => void submitMessage(message.text)}
            >
              <PromptInputBody>
                <PromptInputTextarea
                  disabled={!ready}
                  placeholder="Message this thread…"
                  className="max-h-40 min-h-14 resize-none px-3.5 py-3 text-sm leading-relaxed placeholder:text-muted-foreground/55"
                />
              </PromptInputBody>
              <PromptInputFooter className="bg-transparent px-2 py-1.5">
                <PromptInputTools />
                <PromptInputSubmit
                  className="size-7 rounded-none"
                  disabled={!ready && !busy}
                  onStop={stopGeneration}
                  status={status}
                />
              </PromptInputFooter>
            </PromptInput>
            <SandboxStatusBar
              sandboxStatus={project?.sandboxStatus}
              runtimeStatus={runtimeStatus}
              checking={runtimeStatusLoading}
            />
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
        projectId={projectId}
        threadId={threadId}
        threadTitle={thread?.title}
        baseBranch={project?.currentBranch ?? project?.repoBranch ?? project?.defaultBranch}
        pullRequestStatus={thread?.pullRequestStatus}
        pullRequestUrl={thread?.pullRequestUrl}
        pullRequestNumber={thread?.pullRequestNumber}
        pullRequestBranch={thread?.pullRequestBranch}
        pullRequestError={thread?.pullRequestError}
      />
    </section>
  );
}

function ProjectThreadPageContent() {
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
  const [diffPanelOpen, setDiffPanelOpen] = useState(false);
  const [diffCount, setDiffCount] = useState(0);

  const initialMessages = useMemo(() => dbMessages?.map(toUIMessage) ?? [], [dbMessages]);
  const shouldAutoSubmitInitialPrompt = Boolean(initialPrompt && dbMessages && dbMessages.length === 0);
  const loading = project === undefined || thread === undefined || dbMessages === undefined;
  const notFound = !loading && (!project || !thread || thread.projectId !== projectId);
  const disabled = !project || project.sandboxStatus !== "ready";

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
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.delete("prompt");
    const nextQuery = nextSearchParams.toString();
    router.replace(`${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}` as Route, { scroll: false });
  }, [router, searchParams]);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <header className="relative z-10 flex h-12 shrink-0 items-center border-b border-border/70 bg-background/95 px-3 backdrop-blur sm:px-4">
              <SidebarTrigger className="mr-2" />

              <div className="flex min-w-0 flex-1 items-center gap-2">
                <h1 className="min-w-0 truncate text-sm font-semibold">
                  {thread?.title ?? initialPrompt ?? "Loading thread"}
                </h1>
              </div>

              <div className="flex items-center gap-1.5">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-controls="thread-changes-panel"
                        aria-expanded={diffPanelOpen}
                        aria-label={diffPanelOpen ? "Hide changes" : "Show changes"}
                        data-diff-panel-state={diffPanelOpen ? "open" : "closed"}
                        onClick={() => setDiffPanelOpen((open) => !open)}
                        className={cn(
                          "group/changes-trigger relative size-7 rounded-[6px] text-muted-foreground/85",
                          "transition-[background-color,color,transform,box-shadow] duration-200 ease-out",
                          "hover:bg-foreground/[0.06] hover:text-foreground",
                          "active:scale-[0.92] active:bg-foreground/[0.10]",
                          "focus-visible:bg-foreground/[0.06] focus-visible:ring-[1.5px] focus-visible:ring-sidebar-primary/40 focus-visible:ring-offset-0",
                          "dark:hover:bg-foreground/[0.08] dark:active:bg-foreground/[0.12]",
                          "data-[diff-panel-state=open]:bg-foreground/[0.07] data-[diff-panel-state=open]:text-foreground",
                          "dark:data-[diff-panel-state=open]:bg-foreground/[0.10]",
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
                          aria-hidden="true"
                        >
                          {/* Right-section fill — fades in when the changes panel is open (sidebar.right.fill) */}
                          <path
                            d="M15 5 L18.5 5 A2.5 2.5 0 0 1 21 7.5 L21 16.5 A2.5 2.5 0 0 1 18.5 19 L15 19 Z"
                            fill="currentColor"
                            stroke="none"
                            className="opacity-0 transition-opacity duration-300 ease-out group-data-[diff-panel-state=open]/changes-trigger:opacity-[0.22]"
                          />
                          {/* Outer panel */}
                          <rect x="3" y="5" width="18" height="14" rx="2.5" />
                          {/* Divider */}
                          <line x1="15" y1="5" x2="15" y2="19" />
                        </svg>
                        {diffCount > 0 ? (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "pointer-events-none absolute -right-1 -top-1 inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-1",
                              "bg-sidebar-primary font-mono text-[9px] font-semibold leading-none text-sidebar-primary-foreground",
                              "shadow-[0_0_0_1.5px_var(--background)]",
                            )}
                          >
                            {diffCount > 99 ? "99+" : diffCount}
                          </span>
                        ) : null}
                        <span className="sr-only">
                          {diffPanelOpen ? "Hide changes" : "Show changes"}
                        </span>
                      </Button>
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
              </div>
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

export default function ProjectThreadPage() {
  return (
    <Suspense fallback={<Loader />}>
      <ProjectThreadPageContent />
    </Suspense>
  );
}
