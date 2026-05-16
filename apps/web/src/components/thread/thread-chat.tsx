import { useChat } from "@ai-sdk/react";
import { api } from "@autopr/backend/convex/_generated/api";
import { Badge } from "@autopr/ui/components/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@autopr/ui/components/tooltip";
import { cn } from "@autopr/ui/lib/utils";
import { WorkflowChatTransport } from "@workflow/ai";
import { useAction } from "convex/react";
import { parsePatch } from "diff";
import {
  getToolName,
  isToolUIPart,
  type PrepareReconnectToStreamRequest,
  type UIMessage,
} from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
  isToolDiffPayload,
  toolSlugFromPart,
  type ToolDiffPayload,
} from "@/components/ai-elements/tool";
import { ThreadDiffPanel } from "#/components/thread/thread-diff-panel";
import { SandboxStatusBar, ThreadMessages } from "#/components/thread/thread-messages";
import type { ThreadDiffEntry } from "#/components/thread/thread-diff-panel-utils";

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

function findLastBy<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && predicate(item)) {
      return item;
    }
  }

  return undefined;
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

const MINIMAX_M27_CONTEXT_LIMIT = 204_800;

interface AssistantUsageMetadata {
  usage?: {
    inputTokens?: unknown;
    outputTokens?: unknown;
    totalTokens?: unknown;
    cachedInputTokens?: unknown;
  };
}

function asFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isAssistantUsageMetadata(value: unknown): value is AssistantUsageMetadata {
  return isRecord(value) && (value.usage === undefined || isRecord(value.usage));
}

function formatTokens(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  }

  return `${value}`;
}

function ThreadContextRemainingIndicator({
  inputTokens,
  cachedInputTokens,
  outputTokens,
  contextLimit,
}: {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  contextLimit: number;
}) {
  if (contextLimit <= 0) {
    return null;
  }

  const remainingTokens = Math.max(0, contextLimit - inputTokens);
  const percentageUsed = Math.min(100, Math.round((inputTokens / contextLimit) * 100));
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);

  return (
    <Tooltip>
      <TooltipTrigger>
        <Badge
          variant="outline"
          className="h-7 shrink-0 items-center gap-2 rounded-none border-border/55 bg-background/70 px-2.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-border hover:bg-muted/40"
        >
          <span className="text-foreground/85 tabular-nums">{formatTokens(remainingTokens)}</span>
          <span aria-hidden="true" className="h-3 w-px bg-border/70" />
          <span className="text-muted-foreground/70 tabular-nums">{percentageUsed}%</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="min-w-[220px] rounded-none">
        <div className="space-y-1.5 font-mono text-[11px]">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Remaining</span>
            <span>{formatTokens(remainingTokens)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Input / limit</span>
            <span>
              {formatTokens(inputTokens)} / {formatTokens(contextLimit)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Cached input</span>
            <span>{formatTokens(cachedInputTokens)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Uncached input</span>
            <span>{formatTokens(uncachedInputTokens)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Output</span>
            <span>{formatTokens(outputTokens)}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function ThreadChat({
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

  const { messages, setMessages, sendMessage, resumeStream, status, stop, error, clearError } = useChat<UIMessage>({
    id: threadId,
    messages: initialMessages,
    transport,
    experimental_throttle: 50,
    onError: (chatError) => {
      if (!isExpectedStreamAbort(chatError)) {
        throw chatError;
      }
    },
  });

  useEffect(() => {
    setMessages((currentMessages) => currentMessages.map((message) => {
      const persistedMessage = initialMessages.find((candidate) => candidate.id === message.id);

      if (!persistedMessage) {
        return message;
      }

      const nextMetadata = persistedMessage.metadata ?? message.metadata;
      const nextParts =
        persistedMessage.parts.length > message.parts.length
          ? persistedMessage.parts
          : message.parts;

      if (nextMetadata === message.metadata && nextParts === message.parts) {
        return message;
      }

      return {
        ...message,
        metadata: nextMetadata,
        parts: nextParts,
      };
    }));
  }, [initialMessages, setMessages]);
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
    const assistantMessage = findLastBy(messages, (message) => message.role === "assistant");

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
  const conversationUsage = useMemo(() => messages.reduce(
    (total, message) => {
      if (!isAssistantUsageMetadata(message.metadata) || !message.metadata.usage) {
        return total;
      }

      return {
        inputTokens: total.inputTokens + asFiniteNumber(message.metadata.usage.inputTokens),
        outputTokens: total.outputTokens + asFiniteNumber(message.metadata.usage.outputTokens),
        cachedInputTokens: total.cachedInputTokens + asFiniteNumber(message.metadata.usage.cachedInputTokens),
      };
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    },
  ), [messages]);

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
          <ThreadMessages
            keyedMessages={keyedMessages}
            ready={ready}
            error={error}
            showingInitialPromptHandoff={showingInitialPromptHandoff}
            initialPrompt={initialPrompt}
            awaitingAgentResponse={awaitingAgentResponse}
            onSubmitMessage={submitMessage}
          />
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
                <PromptInputTools className="min-w-0 flex-1">
                  <ThreadContextRemainingIndicator
                    inputTokens={conversationUsage.inputTokens}
                    cachedInputTokens={conversationUsage.cachedInputTokens}
                    outputTokens={conversationUsage.outputTokens}
                    contextLimit={MINIMAX_M27_CONTEXT_LIMIT}
                  />
                </PromptInputTools>
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
