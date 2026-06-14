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
import { WorkflowChatTransport } from "@workflow/ai";
import { useAccessToken } from "@workos/authkit-tanstack-react-start/client";
import { useAction, useMutation } from "convex/react";
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
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import {
  isToolDiffPayload,
  toolSlugFromPart,
  type ToolDiffPayload,
} from "@/components/ai-elements/tool";
import { FileSuggestionsDropdown } from "#/components/thread/file-suggestions-dropdown";
import {
  PromptImageAttachments,
  PromptImageUploadButton,
  usePromptImageUploadManager,
} from "#/components/thread/prompt-image-uploads";
import { ThreadDiffPanel } from "#/components/thread/thread-diff-panel";
import { ThreadMessages } from "#/components/thread/thread-messages";
import { useFileSuggestions } from "#/hooks/use-file-suggestions";
import {
  CODEX_MODELS,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT,
  getCodexReasoningEffortLabel,
  getCodexReasoningEfforts,
  type CodexModelId,
  type CodexReasoningEffort,
} from "#/lib/codex-models";
export { CODEX_MODELS, DEFAULT_CODEX_MODEL, isCodexModelId } from "#/lib/codex-models";
export type { CodexModelId, CodexReasoningEffort } from "#/lib/codex-models";
import type { FileSuggestion } from "#/lib/file-suggestions";
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

function ThreadChatTextarea({
  projectId,
  disabled,
}: {
  projectId: string;
  disabled: boolean;
}) {
  const { textInput } = usePromptInputController();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [files, setFiles] = useState<FileSuggestion[] | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const listSandboxFiles = useAction(api.projectActions.listSandboxFiles);

  const filesRequestProjectRef = useRef<string | null>(null);
  const filesMountedRef = useRef(true);

  useEffect(() => () => {
    filesMountedRef.current = false;
  }, []);

  useEffect(() => {
    filesRequestProjectRef.current = null;
    setFiles(null);
    setFilesLoading(false);
  }, [projectId]);

  const insertFileMention = useCallback((value: string, mentionStart: number, cursorPos: number) => {
    const beforeMention = textInput.value.slice(0, mentionStart);
    const afterCursor = textInput.value.slice(cursorPos);
    const inserted = `@${value} `;
    const nextValue = `${beforeMention}${inserted}${afterCursor}`;
    const nextCursor = beforeMention.length + inserted.length;

    textInput.setInput(nextValue);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
      setCursorPosition(nextCursor);
    });
  }, [textInput]);

  const fileSuggestions = useFileSuggestions({
    inputValue: textInput.value,
    cursorPosition,
    files,
    onSelect: insertFileMention,
  });

  const hasFileMention = fileSuggestions.mentionInfo !== null;

  useEffect(() => {
    if (!hasFileMention || filesRequestProjectRef.current === projectId) {
      return;
    }

    filesRequestProjectRef.current = projectId;
    setFilesLoading(true);

    void listSandboxFiles({ projectId })
      .then((result) => {
        if (filesMountedRef.current && filesRequestProjectRef.current === projectId) setFiles(result);
      })
      .catch(() => {
        if (filesMountedRef.current && filesRequestProjectRef.current === projectId) setFiles([]);
      })
      .finally(() => {
        if (filesMountedRef.current && filesRequestProjectRef.current === projectId) setFilesLoading(false);
      });
  }, [hasFileMention, listSandboxFiles, projectId]);

  const updateCursorPosition = useCallback((element: HTMLTextAreaElement) => {
    setCursorPosition(element.selectionStart);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    setCursorPosition(textarea?.selectionStart ?? textInput.value.length);
  }, [textInput.value]);

  return (
    <div className="relative w-full min-w-0">
      <FileSuggestionsDropdown
        suggestions={fileSuggestions.suggestions}
        selectedIndex={fileSuggestions.selectedIndex}
        isLoading={filesLoading && fileSuggestions.mentionInfo !== null}
        isOpen={fileSuggestions.mentionInfo !== null}
        onSelect={(suggestion) => {
          if (!fileSuggestions.mentionInfo) return;
          insertFileMention(suggestion.value, fileSuggestions.mentionInfo.mentionStart, cursorPosition);
        }}
      />
      <PromptInputTextarea
        ref={textareaRef}
        disabled={disabled}
        placeholder="Message this thread… use @ to tag files"
        className="max-h-40 min-h-14 resize-none px-3.5 py-3 text-sm leading-relaxed placeholder:text-muted-foreground/55"
        onBlur={(event) => updateCursorPosition(event.currentTarget)}
        onClick={(event) => updateCursorPosition(event.currentTarget)}
        onChange={(event) => updateCursorPosition(event.currentTarget)}
        onInput={(event) => updateCursorPosition(event.currentTarget)}
        onKeyDown={(event) => {
          if (fileSuggestions.handleKeyDown(event)) return;
          updateCursorPosition(event.currentTarget);
        }}
        onKeyUp={(event) => updateCursorPosition(event.currentTarget)}
        onSelect={(event) => updateCursorPosition(event.currentTarget)}
      />
    </div>
  );
}

interface AssistantUsageMetadata {
  usage?: TokenUsageMetadata;
  contextUsage?: TokenUsageMetadata;
}

type TokenUsageMetadata = {
  inputTokens?: unknown;
  outputTokens?: unknown;
  totalTokens?: unknown;
  cachedInputTokens?: unknown;
};

type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
};

type WorkflowIssue = {
  message?: unknown;
};

function asFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isAssistantUsageMetadata(value: unknown): value is AssistantUsageMetadata {
  return (
    isRecord(value) &&
    (value.usage === undefined || isRecord(value.usage)) &&
    (value.contextUsage === undefined || isRecord(value.contextUsage))
  );
}

function readTokenUsage(value: unknown): TokenUsage | null {
  if (!isRecord(value)) {
    return null;
  }

  const hasTokenUsage = ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens"].some(
    (key) => typeof value[key] === "number" && Number.isFinite(value[key]),
  );

  if (!hasTokenUsage) {
    return null;
  }

  return {
    inputTokens: asFiniteNumber(value.inputTokens),
    outputTokens: asFiniteNumber(value.outputTokens),
    totalTokens: asFiniteNumber(value.totalTokens),
    cachedInputTokens: asFiniteNumber(value.cachedInputTokens),
  };
}

function contextTokensFromUsage(usage: TokenUsage) {
  return usage.totalTokens > 0 ? usage.totalTokens : usage.inputTokens + usage.outputTokens;
}

function getAssistantContextUsage(metadata: unknown): TokenUsage | null {
  if (!isAssistantUsageMetadata(metadata)) {
    return null;
  }

  return readTokenUsage(metadata.contextUsage) ?? readTokenUsage(metadata.usage);
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

function WorkflowIssuePanel({ issue }: { issue: WorkflowIssue | undefined }) {
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
  contextLimit,
}: {
  usage: TokenUsage;
  contextLimit: number;
}) {
  if (contextLimit <= 0) {
    return null;
  }

  const contextTokens = contextTokensFromUsage(usage);
  const remainingTokens = Math.max(0, contextLimit - contextTokens);
  const percentageUsed = Math.min(100, Math.round((contextTokens / contextLimit) * 100));
  const uncachedInputTokens = Math.max(0, usage.inputTokens - usage.cachedInputTokens);

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
            <span className="text-muted-foreground">Context / limit</span>
            <span>
              {formatTokens(contextTokens)} / {formatTokens(contextLimit)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Input</span>
            <span>{formatTokens(usage.inputTokens)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Cached input</span>
            <span>{formatTokens(usage.cachedInputTokens)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Uncached input</span>
            <span>{formatTokens(uncachedInputTokens)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Output</span>
            <span>{formatTokens(usage.outputTokens)}</span>
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
  initialModel,
  initialReasoningEffort,
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
  initialModel?: CodexModelId;
  initialReasoningEffort?: CodexReasoningEffort;
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
  const selectedModel: CodexModelId = initialModel ?? DEFAULT_CODEX_MODEL;
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<CodexReasoningEffort>(
    initialReasoningEffort ?? DEFAULT_CODEX_REASONING_EFFORT,
  );
  const [optimisticDemoEnabled, setOptimisticDemoEnabled] = useState(Boolean(thread?.demoEnabled));
  const [demoSaving, setDemoSaving] = useState(false);
  const imageUploads = usePromptImageUploadManager();
  const selectedReasoningEfforts = useMemo(() => getCodexReasoningEfforts(selectedModel), [selectedModel]);
  const setDemoEnabled = useMutation(api.threads.setDemoEnabled);
  const { refresh: refreshWorkOSAccessToken } = useAccessToken();

  useEffect(() => {
    if (currentRunId) {
      activeRunIdRef.current = currentRunId;
    }
  }, [currentRunId]);

  useEffect(() => {
    setOptimisticDemoEnabled(Boolean(thread?.demoEnabled));
  }, [thread?.demoEnabled]);

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
        prepareSendMessagesRequest: async (options) => {
          await refreshWorkOSAccessToken();

          return {
            api: options.api,
            body: {
              message: options.messages[options.messages.length - 1],
              model: selectedModel,
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
  const toggleDemoEnabled = useCallback(async () => {
    const nextDemoEnabled = !optimisticDemoEnabled;
    setOptimisticDemoEnabled(nextDemoEnabled);
    setDemoSaving(true);

    try {
      await setDemoEnabled({ threadId, demoEnabled: nextDemoEnabled });
    } catch (toggleError) {
      setOptimisticDemoEnabled(!nextDemoEnabled);
      console.error("Failed to update demo mode", toggleError);
    } finally {
      setDemoSaving(false);
    }
  }, [optimisticDemoEnabled, setDemoEnabled, threadId]);
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
  const currentContextUsage = useMemo(() => {
    const latestAssistantWithUsage = findLastBy(messages, (message) =>
      message.role === "assistant" && getAssistantContextUsage(message.metadata) !== null
    );

    return getAssistantContextUsage(latestAssistantWithUsage?.metadata) ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
    };
  }, [messages]);
  const selectedModelContextLimit =
    CODEX_MODELS.find((model) => model.id === selectedModel)?.contextLimit ?? 400_000;

  useEffect(() => {
    if (!selectedReasoningEfforts.includes(selectedReasoningEffort)) {
      setSelectedReasoningEffort(DEFAULT_CODEX_REASONING_EFFORT);
    }
  }, [selectedReasoningEffort, selectedReasoningEfforts]);

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
    onInitialPromptConsumed?.();
    void submitMessage(
      handoff
        ? handoff.files.length > 0
          ? { text: handoff.text, files: handoff.files }
          : handoff.text
        : fallbackPrompt,
    );
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
            <WorkflowIssuePanel issue={thread?.workflowIssue} />
            <PromptInputProvider>
              <PromptInput
                className={cn(
                  // Sharp, flat, matches dashboard panels (border-border + bg-card)
                  "overflow-visible border border-border bg-card shadow-none transition-colors",
                  "focus-within:border-primary/60",
                )}
                accept="image/*"
                clearOnSubmit="submit"
                multiple
                onSubmit={(message) => submitMessage(message)}
              >
                <PromptInputHeader className="px-2.5 pt-2.5 pb-0">
                  <PromptImageAttachments
                    disabled={!ready}
                    manager={imageUploads}
                  />
                </PromptInputHeader>
                <PromptInputBody>
                  <ThreadChatTextarea projectId={projectId} disabled={!ready} />
                </PromptInputBody>
                <PromptInputFooter className="bg-transparent px-2 py-1.5">
                  <PromptInputTools className="min-w-0 flex-1">
                    <PromptImageUploadButton disabled={!ready} />
                    <span className="inline-flex h-7 shrink-0 items-center px-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      {CODEX_MODELS[0].label}
                    </span>
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
                              "inline-flex h-7 shrink-0 items-center gap-1.5 border border-transparent px-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground transition",
                              "hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
                              optimisticDemoEnabled && "border-primary/35 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
                            )}
                          >
                            <Video className="size-3.5" aria-hidden />
                            <span>Demo</span>
                          </button>
                        }
                      />
                      <TooltipContent side="top" align="start" className="max-w-64 rounded-none">
                        {optimisticDemoEnabled
                          ? "Future runs in this thread will record a Daytona browser demo."
                          : "Allow future runs to record a Daytona browser demo."}
                      </TooltipContent>
                    </Tooltip>
                    <ThreadContextRemainingIndicator
                      usage={currentContextUsage}
                      contextLimit={selectedModelContextLimit}
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
            </PromptInputProvider>
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
