import { useChat } from "@ai-sdk/react";
import { api } from "@autopr/backend/convex/_generated/api";
import { Badge } from "@autopr/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@autopr/ui/components/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@autopr/ui/components/tooltip";
import { cn } from "@autopr/ui/lib/utils";
import { useAccessToken } from "@workos/authkit-tanstack-react-start/client";
import { useMutation } from "convex/react";
import { parsePatch } from "diff";
import {
  getToolName,
  isToolUIPart,
  type FileUIPart,
  type PrepareReconnectToStreamRequest,
  type UIMessage,
} from "ai";
import { Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TriggerChatTransport } from "#/lib/trigger-chat-transport";

import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
  isToolDiffPayload,
  toolSlugFromPart,
  type ToolDiffPayload,
} from "@/components/ai-elements/tool";
import {
  PromptImageAttachments,
  PromptImageUploadButton,
  usePromptImageUploadManager,
} from "#/components/thread/prompt-image-uploads";
import {
  CodexPromptConnectionLine,
  type CodexPromptConnectionIssue,
} from "#/components/codex-prompt-connection-line";
import { ThreadDiffPanel } from "#/components/thread/thread-diff-panel";
import { ThreadMessages } from "#/components/thread/thread-messages";
import {
  CODEX_MODELS,
  DEFAULT_CODEX_REASONING_EFFORT,
  addCodexUsageCosts,
  calculateCodexUsageCost,
  emptyCodexUsageCost,
  formatCodexModelLabel,
  getCodexModelOptions,
  getCodexReasoningEffortLabel,
  getCodexReasoningEfforts,
  normalizeCodexModelList,
  selectCodexModel,
  type CodexModelId,
  type CodexReasoningEffort,
} from "#/lib/codex-models";
export { CODEX_MODELS, DEFAULT_CODEX_MODEL, isCodexModelId } from "#/lib/codex-models";
export type { CodexModelId, CodexReasoningEffort } from "#/lib/codex-models";
import type { ThreadDiffEntry } from "#/components/thread/thread-diff-panel-utils";
import {
  contextTokensFromUsage,
  formatRunCost,
  formatTokens,
  getAssistantContextUsage,
  getAssistantRunCost,
  getAssistantRunUsage,
  withAssistantRunMetadata,
  type TokenCost,
  type TokenUsage,
} from "#/lib/assistant-message-metadata";
import { mergePersistedAssistantParts } from "#/lib/chat-messages";

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

type ThreadPromptHandoff = {
  text: string;
  files: FileUIPart[];
};

const threadPromptHandoffKey = (threadId: string) => `thread-prompt-handoff:${threadId}`;

function isHandoffFilePart(value: unknown): value is FileUIPart {
  return (
    isRecord(value) &&
    value.type === "file" &&
    typeof value.url === "string" &&
    typeof value.mediaType === "string" &&
    (value.filename === undefined || typeof value.filename === "string")
  );
}

function readThreadPromptHandoff(threadId: string): ThreadPromptHandoff | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(threadPromptHandoffKey(threadId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }

    const text = typeof parsed.text === "string" ? parsed.text : "";
    const files = Array.isArray(parsed.files) ? parsed.files.filter(isHandoffFilePart) : [];

    return text.trim() || files.length > 0 ? { text, files } : null;
  } catch {
    return null;
  }
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
  if (diff.status === "added" || diff.status === "deleted" || diff.status === "modified") {
    return diff.status;
  }

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

function ThreadChatTextarea({ disabled }: { disabled: boolean }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="relative w-full min-w-0">
      <PromptInputTextarea
        ref={textareaRef}
        disabled={disabled}
        placeholder="Message this thread..."
        className="max-h-40 min-h-14 resize-none px-3.5 py-3 text-sm leading-relaxed placeholder:text-muted-foreground/55"
      />
    </div>
  );
}

type AgentRunIssue = {
  message?: unknown;
};

function parseEmbeddedErrorMessage(message: string) {
  const jsonStart = message.indexOf("{");
  const jsonEnd = message.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    return message;
  }

  try {
    const parsed = JSON.parse(message.slice(jsonStart, jsonEnd + 1));
    if (
      isRecord(parsed) &&
      isRecord(parsed.error) &&
      typeof parsed.error.message === "string" &&
      parsed.error.message.length > 0
    ) {
      return parsed.error.message;
    }
  } catch {
    return message;
  }

  return message;
}

function AgentRunIssuePanel({ issue }: { issue: AgentRunIssue | undefined }) {
  if (!issue || typeof issue.message !== "string") {
    return null;
  }

  const message = parseEmbeddedErrorMessage(issue.message);

  return (
    <div className="mb-4 border border-destructive/35 bg-destructive/5 px-3.5 py-3 text-sm text-muted-foreground">
      <p className="break-words">{message}</p>
    </div>
  );
}

function ThreadContextRemainingIndicator({
  usage,
  threadCost,
  contextLimit,
}: {
  usage: TokenUsage;
  threadCost?: TokenCost | null;
  contextLimit: number;
}) {
  if (contextLimit <= 0) {
    return null;
  }

  const contextTokens = contextTokensFromUsage(usage);
  const remainingTokens = Math.max(0, contextLimit - contextTokens);
  const percentageUsed = Math.min(100, Math.round((contextTokens / contextLimit) * 100));
  const uncachedInputTokens = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const hasThreadCost = threadCost !== null && threadCost !== undefined && threadCost.total > 0;

  return (
    <Tooltip>
      <TooltipTrigger>
        <Badge
          variant="outline"
          aria-label={`Context remaining: ${formatTokens(remainingTokens)}`}
          className="h-7 shrink-0 cursor-help items-center rounded-[var(--radius-pill)] border-border/55 bg-background/70 px-2 font-mono text-[11px] text-muted-foreground transition-colors hover:border-border hover:bg-muted/40"
        >
          <span className="text-foreground/85 tabular-nums">{formatTokens(remainingTokens)}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="rounded-none">
        <div className="grid grid-cols-[max-content_max-content] gap-x-6 gap-y-1.5 font-mono text-[11px]">
          <div className="contents">
            <span className="text-muted-foreground">Remaining</span>
            <span className="text-right tabular-nums">{formatTokens(remainingTokens)}</span>
          </div>
          <div className="contents">
            <span className="text-muted-foreground">Context / limit</span>
            <span className="text-right tabular-nums">
              {formatTokens(contextTokens)} / {formatTokens(contextLimit)}
            </span>
          </div>
          <div className="contents">
            <span className="text-muted-foreground">Input</span>
            <span className="text-right tabular-nums">{formatTokens(usage.inputTokens)}</span>
          </div>
          <div className="contents">
            <span className="text-muted-foreground">Cached input</span>
            <span className="text-right tabular-nums">{formatTokens(usage.cachedInputTokens)}</span>
          </div>
          <div className="contents">
            <span className="text-muted-foreground">Cache write</span>
            <span className="text-right tabular-nums">{formatTokens(usage.cacheWriteTokens)}</span>
          </div>
          <div className="contents">
            <span className="text-muted-foreground">Uncached input</span>
            <span className="text-right tabular-nums">{formatTokens(uncachedInputTokens)}</span>
          </div>
          <div className="contents">
            <span className="text-muted-foreground">Output</span>
            <span className="text-right tabular-nums">{formatTokens(usage.outputTokens)}</span>
          </div>
          {hasThreadCost ? (
            <>
              <div className="col-span-2 my-0.5 h-px bg-border/70" />
              <div className="contents">
                <span className="text-muted-foreground">Thread cost</span>
                <span className="text-right tabular-nums">{formatRunCost(threadCost.total)}</span>
              </div>
              <div className="contents">
                <span className="text-muted-foreground">Input cost</span>
                <span className="text-right tabular-nums">{formatRunCost(threadCost.input)}</span>
              </div>
              <div className="contents">
                <span className="text-muted-foreground">Cached cost</span>
                <span className="text-right tabular-nums">{formatRunCost(threadCost.cacheRead)}</span>
              </div>
              <div className="contents">
                <span className="text-muted-foreground">Output cost</span>
                <span className="text-right tabular-nums">{formatRunCost(threadCost.output)}</span>
              </div>
            </>
          ) : null}
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
  initialModel,
  initialReasoningEffort,
  availableModels,
  disabled,
  codexPromptIssue,
  diffPanelOpen,
  demoRecordingExperimentEnabled,
  onDiffPanelOpenChange,
  onDiffCountChange,
  project,
  thread,
}: {
  projectId: string;
  threadId: string;
  currentRunId?: string;
  initialMessages: UIMessage[];
  initialPrompt?: string;
  initialModel?: CodexModelId;
  initialReasoningEffort?: CodexReasoningEffort;
  availableModels?: string[];
  disabled: boolean;
  codexPromptIssue?: CodexPromptConnectionIssue;
  diffPanelOpen: boolean;
  demoRecordingExperimentEnabled: boolean;
  onDiffPanelOpenChange: (open: boolean) => void;
  onDiffCountChange: (count: number) => void;
  project?: any;
  thread?: any;
}) {
  const activeRunIdRef = useRef(currentRunId);
  const activeRunStartedAtRef = useRef<number | undefined>(undefined);
  const resumedRunIdsRef = useRef<Set<string>>(null!);
  resumedRunIdsRef.current ??= new Set<string>();
  const hasAutoSubmittedInitialPromptRef = useRef(false);
  const pendingStopRef = useRef<Promise<void> | null>(null);
  const [selectedDiffEntryId, setSelectedDiffEntryId] = useState<string | undefined>();
  const [diffPanelMaximized, setDiffPanelMaximized] = useState(false);
  const [selectedModelChoice, setSelectedModelChoice] = useState<string | undefined>(initialModel);
  const availableCodexModels = useMemo(
    () => normalizeCodexModelList(availableModels),
    [availableModels],
  );
  const selectedModel = useMemo(
    () => selectCodexModel(availableCodexModels, selectedModelChoice),
    [availableCodexModels, selectedModelChoice],
  );
  const modelOptions = useMemo(
    () => getCodexModelOptions(availableCodexModels, selectedModel),
    [availableCodexModels, selectedModel],
  );
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<CodexReasoningEffort>(
    initialReasoningEffort ?? DEFAULT_CODEX_REASONING_EFFORT,
  );
  const [pendingDemoEnabled, setPendingDemoEnabled] = useState<boolean | undefined>();
  const [demoSaving, setDemoSaving] = useState(false);
  const imageUploads = usePromptImageUploadManager();
  const selectedReasoningEfforts = useMemo(() => getCodexReasoningEfforts(selectedModel), [selectedModel]);
  const setDemoEnabled = useMutation(api.threads.setDemoEnabled);
  const { refresh: refreshWorkOSAccessToken } = useAccessToken();

  if (currentRunId) {
    activeRunIdRef.current = currentRunId;
  }

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
    const triggerRunId = response.headers.get("x-trigger-run-id");
    if (triggerRunId) {
      activeRunIdRef.current = triggerRunId;
      resumedRunIdsRef.current.add(triggerRunId);
      if (!activeRunStartedAtRef.current) {
        const startedAt = Date.now();
        activeRunStartedAtRef.current = startedAt;
      }
    }
  }, []);

  const handleChatEnd = useCallback(() => {
    activeRunIdRef.current = undefined;
    activeRunStartedAtRef.current = undefined;
  }, []);

  const prepareReconnectToStreamRequest = useCallback<PrepareReconnectToStreamRequest>(
    (options) => {
      const runId = activeRunIdRef.current;

      if (!runId) {
        throw new Error("No active Trigger.dev run ID found");
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
      new TriggerChatTransport<UIMessage>({
        api: agentApi,
        onChatSendMessage: handleChatSendMessage,
        onChatEnd: handleChatEnd,
        prepareSendMessagesRequest: async (options) => {
          await refreshWorkOSAccessToken();

          return {
            api: options.api,
            body: {
              message: options.messages[options.messages.length - 1],
              ...(selectedModel ? { model: selectedModel } : {}),
              reasoningEffort: selectedReasoningEffort,
            },
            headers: options.headers,
            credentials: options.credentials,
          };
        },
        prepareReconnectToStreamRequest,
      }),
    [
      agentApi,
      handleChatEnd,
      handleChatSendMessage,
      prepareReconnectToStreamRequest,
      refreshWorkOSAccessToken,
      selectedModel,
      selectedReasoningEffort,
    ],
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

  const allowPersistedPartRemoval = status === "ready" && !currentRunId;

  useEffect(() => {
    setMessages((currentMessages) => {
      const currentMessagesById = new Map(
        currentMessages.map((message) => [message.id, message])
      );
      const mergedMessages: UIMessage[] = [];
      const mergedMessageIds = new Set<string>();

      for (const persistedMessage of initialMessages) {
        const currentMessage = currentMessagesById.get(persistedMessage.id);

        if (!currentMessage) {
          mergedMessages.push(persistedMessage);
          mergedMessageIds.add(persistedMessage.id);
          continue;
        }

        const nextMetadata = persistedMessage.metadata ?? currentMessage.metadata;
        const nextParts = currentMessage.role === "assistant"
          ? mergePersistedAssistantParts(currentMessage.parts, persistedMessage.parts, {
            allowPersistedRemoval: allowPersistedPartRemoval,
          })
          : persistedMessage.parts.length > currentMessage.parts.length
            ? persistedMessage.parts
            : currentMessage.parts;

        if (nextMetadata === currentMessage.metadata && nextParts === currentMessage.parts) {
          mergedMessages.push(currentMessage);
          mergedMessageIds.add(currentMessage.id);
          continue;
        }

        mergedMessages.push({
          ...currentMessage,
          metadata: nextMetadata,
          parts: nextParts,
        });
        mergedMessageIds.add(currentMessage.id);
      }

      for (const message of currentMessages) {
        if (!mergedMessageIds.has(message.id)) {
          mergedMessages.push(message);
        }
      }

      if (
        mergedMessages.length === currentMessages.length &&
        mergedMessages.every((message, index) => message === currentMessages[index])
      ) {
        return currentMessages;
      }

      return mergedMessages;
    });
  }, [allowPersistedPartRemoval, initialMessages, setMessages]);
  const lastMessage = messages.at(-1);
  const hasPersistedLastAssistantMessage = lastMessage?.role === "assistant" && lastMessage.parts.length > 0;
  const diffEntries = useMemo(() => extractThreadDiffEntries(messages), [messages]);
  const selectedDiffEntry = selectedDiffEntryId
    ? diffEntries.find((entry) => entry.id === selectedDiffEntryId)
    : undefined;
  const effectiveSelectedDiffEntryId = selectedDiffEntry?.id ?? diffEntries.at(-1)?.id;

  useEffect(() => {
    onDiffCountChange(diffEntries.length);
  }, [diffEntries.length, onDiffCountChange]);

  useEffect(() => {
    if (!currentRunId || status !== "ready" || resumedRunIdsRef.current.has(currentRunId)) {
      return;
    }

    resumedRunIdsRef.current.add(currentRunId);

    // AI SDK streams append to the current assistant message when resuming.
    // If the last assistant message already has persisted parts, replaying the
    // Trigger.dev stream from index 0 would duplicate that content in the UI.
    if (hasPersistedLastAssistantMessage) {
      activeRunIdRef.current = undefined;
      return;
    }

    void resumeStream();
  }, [currentRunId, hasPersistedLastAssistantMessage, resumeStream, status]);

  const busy = status === "submitted" || status === "streaming";
  const ready = status === "ready" && !disabled;
  if ((currentRunId || busy) && !activeRunStartedAtRef.current) {
    activeRunStartedAtRef.current = Date.now();
  }
  if (!busy && !activeRunIdRef.current && activeRunStartedAtRef.current) {
    activeRunStartedAtRef.current = undefined;
  }
  const activeRunStartedAt = activeRunStartedAtRef.current;

  const stopGeneration = useCallback(() => {
    const runId = activeRunIdRef.current;
    const assistantMessage = findLastBy(messages, (message) => message.role === "assistant");
    const runStartedAt = activeRunStartedAtRef.current;
    const runCompletedAt = Date.now();
    const assistantMetadata =
      assistantMessage && runStartedAt !== undefined
        ? withAssistantRunMetadata(assistantMessage.metadata, {
            startedAt: runStartedAt,
            completedAt: runCompletedAt,
            durationSeconds: Math.max(0, Math.round((runCompletedAt - runStartedAt) / 1000)),
          })
        : assistantMessage?.metadata;

    try {
      stop();
    } catch (stopError) {
      if (!isExpectedStreamAbort(stopError)) {
        throw stopError;
      }
    }

    clearError();
    activeRunStartedAtRef.current = undefined;

    if (assistantMessage && assistantMetadata !== assistantMessage.metadata) {
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === assistantMessage.id
            ? { ...message, metadata: assistantMetadata }
            : message
        )
      );
    }

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
              metadata: assistantMetadata,
            }
          : undefined,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to cancel Trigger.dev run: ${response.status}`);
        }
      })
      .catch((cancelError) => {
        console.error("Failed to cancel Trigger.dev run", cancelError);
      })
      .finally(() => {
        if (pendingStopRef.current === stopPromise) {
          pendingStopRef.current = null;
        }
      });

    pendingStopRef.current = stopPromise;
  }, [clearError, getRunApi, messages, setMessages, stop]);
  const toggleDemoEnabled = useCallback(async () => {
    const optimisticDemoEnabled = pendingDemoEnabled ?? Boolean(thread?.demoEnabled);

    if (!demoRecordingExperimentEnabled && !optimisticDemoEnabled) {
      return;
    }

    const nextDemoEnabled = !optimisticDemoEnabled;
    setPendingDemoEnabled(nextDemoEnabled);
    setDemoSaving(true);

    try {
      await setDemoEnabled({ threadId, demoEnabled: nextDemoEnabled });
    } catch (toggleError) {
      setPendingDemoEnabled(undefined);
      console.error("Failed to update demo mode", toggleError);
    } finally {
      setDemoSaving(false);
    }
  }, [demoRecordingExperimentEnabled, pendingDemoEnabled, setDemoEnabled, thread?.demoEnabled, threadId]);
  const showingInitialPromptHandoff = Boolean(initialPrompt && messages.length === 0);
  const awaitingAgentResponse = status === "submitted";
  const activeAssistantMessageId = busy && lastMessage?.role === "assistant" ? lastMessage.id : undefined;
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
  const currentContextUsage = useMemo(() => {
    const latestAssistantWithUsage = findLastBy(messages, (message) =>
      message.role === "assistant" && getAssistantContextUsage(message.metadata) !== null
    );

    return getAssistantContextUsage(latestAssistantWithUsage?.metadata) ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    };
  }, [messages]);
  const threadTotalCost = useMemo(() => {
    return messages.reduce((total, message) => {
      if (message.role !== "assistant") {
        return total;
      }

      const savedCost = getAssistantRunCost(message.metadata);
      if (savedCost) {
        return addCodexUsageCosts(total, savedCost);
      }

      const runUsage = getAssistantRunUsage(message.metadata);
      return runUsage ? addCodexUsageCosts(total, calculateCodexUsageCost(selectedModel, runUsage)) : total;
    }, emptyCodexUsageCost());
  }, [messages, selectedModel]);
  const selectedModelContextLimit =
    CODEX_MODELS.find((model) => model.id === selectedModel)?.contextLimit ?? 400_000;

  useEffect(() => {
    if (!selectedReasoningEfforts.includes(selectedReasoningEffort)) {
      setSelectedReasoningEffort(DEFAULT_CODEX_REASONING_EFFORT);
    }
  }, [selectedReasoningEffort, selectedReasoningEfforts]);

  useEffect(() => {
    if (
      selectedModelChoice &&
      availableModels !== undefined &&
      !availableCodexModels.includes(selectedModelChoice)
    ) {
      setSelectedModelChoice(undefined);
    }
  }, [availableCodexModels, availableModels, selectedModelChoice]);

  const submitMessage = useCallback(async (message: string | PromptInputMessage) => {
    const text = typeof message === "string" ? message : message.text;
    const files = typeof message === "string" ? [] : message.files;
    const nextMessage = text.trim();

    if ((!nextMessage && files.length === 0) || disabled) {
      return;
    }

    if (pendingStopRef.current) {
      await pendingStopRef.current;
    }

    if (status !== "ready") {
      return;
    }

    clearError();
    const hasFiles = files.length > 0;

    const uploadedFiles = hasFiles ? await imageUploads.resolveMessageImages(files) : [];

    if (uploadedFiles.length > 0) {
      if (nextMessage) {
        await sendMessage({ text: nextMessage, files: uploadedFiles });
      } else {
        await sendMessage({ files: uploadedFiles });
      }
      return;
    }

    if (!nextMessage) {
      return;
    }

    await sendMessage({ text: nextMessage });
  }, [clearError, disabled, imageUploads, sendMessage, status]);

  useEffect(() => {
    if (hasAutoSubmittedInitialPromptRef.current || !ready) {
      return;
    }

    const handoff = readThreadPromptHandoff(threadId);
    const fallbackPrompt = initialPrompt ?? "";

    if (!handoff && !fallbackPrompt) {
      return;
    }

    if (messages.length > 0) {
      hasAutoSubmittedInitialPromptRef.current = true;
      return;
    }

    const submittedKey = handoff
      ? `${threadPromptHandoffKey(threadId)}:submitted`
      : `${threadPromptHandoffKey(threadId)}:${fallbackPrompt}`;

    if (window.sessionStorage.getItem(submittedKey) === "submitted") {
      hasAutoSubmittedInitialPromptRef.current = true;
      return;
    }

    hasAutoSubmittedInitialPromptRef.current = true;
    window.sessionStorage.setItem(submittedKey, "submitted");
    if (handoff) {
      window.sessionStorage.removeItem(threadPromptHandoffKey(threadId));
    }
    void submitMessage(
      handoff
        ? handoff.files.length > 0
          ? { text: handoff.text, files: handoff.files }
          : handoff.text
        : fallbackPrompt,
    );
  }, [initialPrompt, messages.length, ready, submitMessage, threadId]);

  const optimisticDemoEnabled = pendingDemoEnabled ?? Boolean(thread?.demoEnabled);
  const showMaximizedDiffPanel = diffPanelOpen && diffPanelMaximized;
  const recordingPlaybackBasePath =
    `/api/project/${encodeURIComponent(projectId)}` +
    `/thread/${encodeURIComponent(threadId)}`;

  return (
    <section
      className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden lg:flex-row"
    >
      <div
        className={cn(
          "grid h-full min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden transition-opacity duration-200 ease-out motion-reduce:transition-none",
          showMaximizedDiffPanel && "lg:pointer-events-none lg:opacity-0",
        )}
        aria-hidden={showMaximizedDiffPanel || undefined}
      >
        <div className="relative min-h-0 min-w-0 overflow-hidden">
          <ThreadMessages
            keyedMessages={keyedMessages}
            ready={ready}
            error={error}
            showingInitialPromptHandoff={showingInitialPromptHandoff}
            initialPrompt={initialPrompt}
            awaitingAgentResponse={awaitingAgentResponse}
            activeAssistantMessageId={activeAssistantMessageId}
            activeRunStartedAt={activeRunStartedAt}
            modelId={selectedModel}
            recordingPlaybackBasePath={recordingPlaybackBasePath}
            onSubmitMessage={submitMessage}
          />
        </div>

        <div className="relative bg-background px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:px-8">
          <div className="mx-auto max-w-[680px]">
            <AgentRunIssuePanel issue={thread?.agentRunIssue ?? thread?.workflowIssue} />
            <PromptInputProvider>
              <PromptInput
                className={cn(
                  "overflow-visible rounded-sm border border-border bg-card shadow-none transition-colors",
                  "focus-within:border-[color:var(--cohere-form-focus)]",
                )}
                accept="image/*"
                clearOnSubmit="submit"
                multiple
                onSubmit={(message) => submitMessage(message)}
              >
                <CodexPromptConnectionLine issue={codexPromptIssue} />
                <PromptInputHeader className="px-2.5 pt-2.5 pb-0">
                  <PromptImageAttachments
                    disabled={!ready}
                    manager={imageUploads}
                  />
                </PromptInputHeader>
                <PromptInputBody>
                  <ThreadChatTextarea disabled={!ready} />
                </PromptInputBody>
                <PromptInputFooter className="bg-transparent px-2 py-1.5">
                  <PromptInputTools className="min-w-0 flex-1">
                    <PromptImageUploadButton disabled={!ready} />
                    <Select
                      value={selectedModel ?? ""}
                      onValueChange={(value) => value && setSelectedModelChoice(value)}
                    >
                      <SelectTrigger
                        size="sm"
                        className="h-7 max-w-[10rem] border-border/40 bg-muted/25 px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground [&_[data-slot=select-value]]:min-w-0"
                        disabled={!ready || modelOptions.length === 0}
                        aria-label="Model"
                      >
                        <SelectValue>
                          {formatCodexModelLabel(selectedModel)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start" alignItemWithTrigger={false} side="top" sideOffset={6} className="w-52 min-w-52 p-1">
                        {modelOptions.map((model) => (
                          <SelectItem key={model} value={model} className="rounded-sm py-1.5 pr-7 pl-2 text-xs">
                            <span className="min-w-0 truncate font-medium">
                              {formatCodexModelLabel(model)}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={selectedReasoningEffort}
                      onValueChange={(value) => value && setSelectedReasoningEffort(value as CodexReasoningEffort)}
                    >
                      <SelectTrigger
                        size="sm"
                        className="h-7 max-w-24 border-border/40 bg-muted/25 px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground [&_[data-slot=select-value]]:min-w-0"
                        aria-label="Reasoning level"
                      >
                        <SelectValue>
                          {getCodexReasoningEffortLabel(selectedReasoningEffort)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start" alignItemWithTrigger={false} side="top" sideOffset={6} className="w-36 min-w-36 p-1">
                        {selectedReasoningEfforts.map((effort) => (
                          <SelectItem key={effort} value={effort} className="rounded-sm py-1.5 pr-7 pl-2 text-xs">
                            <span className="font-medium">
                              {getCodexReasoningEffortLabel(effort)}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {demoRecordingExperimentEnabled ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              role="switch"
                              aria-checked={optimisticDemoEnabled}
                              disabled={demoSaving}
                              onClick={() => void toggleDemoEnabled()}
                              className={cn(
                                "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] border border-transparent px-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground transition",
                                "hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
                                optimisticDemoEnabled && "border-[color:var(--project-selected-strong)] bg-[color:var(--project-selected)] text-[color:var(--project-selected-strong)] hover:bg-[color:var(--project-selected)] hover:text-[color:var(--project-selected-strong)]",
                              )}
                            >
                              <Video className="size-3.5" aria-hidden />
                              <span>Demo</span>
                            </button>
                          }
                        />
                        <TooltipContent side="top" align="start" className="max-w-64 rounded-none">
                          {optimisticDemoEnabled
                            ? "Experimental: future runs in this thread will record a Daytona browser demo and may fail."
                            : "Allow future runs to record an experimental Daytona browser demo."}
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                    <ThreadContextRemainingIndicator
                      usage={currentContextUsage}
                      threadCost={threadTotalCost}
                      contextLimit={selectedModelContextLimit}
                    />
                  </PromptInputTools>
                  <PromptInputSubmit
                    className="size-8 rounded-full"
                    disabled={!ready && !busy}
                    onStop={stopGeneration}
                    status={status}
                  />
                </PromptInputFooter>
              </PromptInput>
            </PromptInputProvider>
          </div>
        </div>
      </div>
      <ThreadDiffPanel
        entries={diffEntries}
        selectedEntryId={effectiveSelectedDiffEntryId}
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
        maximized={showMaximizedDiffPanel}
        onMaximizedChange={setDiffPanelMaximized}
      />
    </section>
  );
}
