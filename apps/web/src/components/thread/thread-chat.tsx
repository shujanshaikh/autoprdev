import { useChat } from "@ai-sdk/react";
import { api } from "@autopr/backend/convex/_generated/api";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@autopr/ui/components/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@autopr/ui/components/popover";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@autopr/ui/components/hover-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@autopr/ui/components/select";
import { cn } from "@autopr/ui/lib/utils";
import {
  useTriggerChatTransport,
  type ChatTransportEvent,
} from "@trigger.dev/sdk/chat/react";
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
import { MoreHorizontal, Video, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { FileTypeIcon } from "#/lib/file-type-icon";
import { TriggerChatTransport } from "#/lib/trigger-chat-transport";
import {
  AGENT_CHAT_OPERATION_HEADER,
  AGENT_CHAT_TASK_ID,
  type AgentChatClientInput,
} from "#/lib/trigger-agent-contract";
import {
  runTriggerSessionReconnectAttempt,
  shouldUseTriggerSessionTransport,
  triggerSessionHydration,
  triggerSessionReconnectDelayMs,
} from "#/lib/trigger-session-reconnect";

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
import { CodexLogo } from "#/components/icons/codex-logo";
import { ThreadDiffPanel } from "#/components/thread/thread-diff-panel";
import { ThreadMessages } from "#/components/thread/thread-messages";
import {
  CODEX_MODELS,
  DEFAULT_CODEX_REASONING_EFFORT,
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
import {
  appendDiffPromptContexts,
  formatDiffPromptContextLabel,
  type DiffPromptContext,
  type ThreadChangedFile,
  type ThreadDiffDeepLink,
  type ThreadDiffEntry,
} from "#/components/thread/thread-diff-panel-utils";
import {
  contextTokensFromUsage,
  formatTokens,
  getAssistantContextUsage,
  getAssistantRunUsage,
  withAssistantRunMetadata,
  type TokenUsage,
} from "#/lib/assistant-message-metadata";
import { mergePersistedAssistantParts } from "#/lib/chat-messages";

type ThreadChatProps = {
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
  diffDeepLink?: ThreadDiffDeepLink;
  demoRecordingExperimentEnabled: boolean;
  onDiffPanelOpenChange: (open: boolean) => void;
  onDiffCountChange: (count: number) => void;
  project?: any;
  thread?: any;
};

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

const promptControlTriggerClassName =
  "h-8 min-w-0 max-w-[36vw] gap-1.5 border-none bg-transparent px-1 text-sm font-semibold text-foreground/80 shadow-none transition-colors hover:bg-transparent hover:text-foreground focus-visible:border-transparent focus-visible:ring-0 data-[size=sm]:h-8 dark:bg-transparent dark:hover:bg-transparent lg:max-w-[10rem] [&_[data-slot=select-value]]:min-w-0 [&_svg:not([class*='size-'])]:size-3.5";

function ThreadChatTextarea({ disabled }: { disabled: boolean }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="relative w-full min-w-0">
      <PromptInputTextarea
        ref={textareaRef}
        disabled={disabled}
        placeholder="Add a follow up..."
        className="max-h-40 min-h-11 resize-none px-3.5 py-2 text-[14px] leading-relaxed"
      />
    </div>
  );
}

function DiffPromptContextChips({
  contexts,
  onRemove,
}: {
  contexts: DiffPromptContext[];
  onRemove: (id: string) => void;
}) {
  if (contexts.length === 0) return null;

  return contexts.map((context) => (
    <span
      key={context.id}
      className="inline-flex h-7 max-w-full items-center gap-1 rounded-[var(--radius-pill)] border border-[color:color-mix(in_srgb,var(--framer-accent-blue)_24%,transparent)] bg-[color:color-mix(in_srgb,var(--framer-accent-blue)_10%,transparent)] pl-2.5 pr-1 text-[color:var(--framer-accent-blue)]"
      title={`${context.file}:${context.start}-${context.end}`}
    >
      <FileTypeIcon file={context.file} className="size-3.5 shrink-0" />
      <span className="truncate font-mono text-[11px] font-medium">
        {formatDiffPromptContextLabel(context)}
      </span>
      <button
        type="button"
        onClick={() => onRemove(context.id)}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-current/60 transition-colors hover:bg-[color:color-mix(in_srgb,var(--framer-accent-blue)_15%,transparent)] hover:text-current focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--framer-accent-blue)]"
        aria-label={`Remove ${formatDiffPromptContextLabel(context)} from prompt`}
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </span>
  ));
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
    <div className="mb-4 min-w-0 max-w-full border border-destructive/35 bg-destructive/5 px-3.5 py-3 text-sm text-muted-foreground">
      <p className="break-words [overflow-wrap:anywhere]">{message}</p>
    </div>
  );
}

const CONTEXT_RING_RADIUS = 9;
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS;
const HOVER_CAPABLE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

function useHasHoverCapablePointer() {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === "undefined") {
        return () => undefined;
      }

      const mediaQuery = window.matchMedia(HOVER_CAPABLE_POINTER_QUERY);
      mediaQuery.addEventListener("change", onStoreChange);
      return () => mediaQuery.removeEventListener("change", onStoreChange);
    },
    () => typeof window !== "undefined" && window.matchMedia(HOVER_CAPABLE_POINTER_QUERY).matches,
    () => false,
  );
}

function ContextWindowDetails({
  contextTokens,
  contextLimit,
  percentageUsed,
  totalProcessedTokens,
}: {
  contextTokens: number;
  contextLimit: number;
  percentageUsed: number;
  totalProcessedTokens: number;
}) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-foreground">Context window</h3>
        <p className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {percentageUsed}% · {formatTokens(contextTokens)}/{formatTokens(contextLimit)}
        </p>
      </div>

      <div
        role="progressbar"
        aria-label="Context window used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentageUsed}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-[color:var(--framer-accent-blue)] transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${percentageUsed}%` }}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">Total processed</span>
        <span className="font-medium tabular-nums text-foreground">
          {formatTokens(totalProcessedTokens)}
        </span>
      </div>

      <p className="mt-3 border-t border-border/60 pt-3 text-xs leading-5 text-muted-foreground">
        Codex automatically compacts its context when needed.
      </p>
    </>
  );
}

function ThreadContextWindowIndicator({
  usage,
  totalProcessedTokens,
  contextLimit,
}: {
  usage: TokenUsage;
  totalProcessedTokens: number;
  contextLimit: number;
}) {
  const hasHoverCapablePointer = useHasHoverCapablePointer();

  if (contextLimit <= 0) {
    return null;
  }

  const contextTokens = contextTokensFromUsage(usage);
  const remainingTokens = Math.max(0, contextLimit - contextTokens);
  const percentageUsed = Math.min(100, Math.round((contextTokens / contextLimit) * 100));
  const ringOffset = CONTEXT_RING_CIRCUMFERENCE * (1 - percentageUsed / 100);
  const accessibleLabel = `Context window: ${percentageUsed}% used, ${formatTokens(remainingTokens)} remaining`;
  const triggerContent = (
    <svg viewBox="0 0 24 24" className="size-6 -rotate-90" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r={CONTEXT_RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        className="text-border/80"
      />
      <circle
        cx="12"
        cy="12"
        r={CONTEXT_RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={CONTEXT_RING_CIRCUMFERENCE}
        strokeDashoffset={ringOffset}
        className="text-[color:var(--framer-accent-blue)] transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none"
      />
    </svg>
  );
  const details = (
    <ContextWindowDetails
      contextTokens={contextTokens}
      contextLimit={contextLimit}
      percentageUsed={percentageUsed}
      totalProcessedTokens={totalProcessedTokens}
    />
  );
  const triggerClassName = "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45";

  if (hasHoverCapablePointer) {
    return (
      <HoverCard>
        <HoverCardTrigger
          render={<button type="button" />}
          delay={120}
          closeDelay={120}
          aria-label={accessibleLabel}
          className={triggerClassName}
        >
          {triggerContent}
        </HoverCardTrigger>
        <HoverCardContent
          align="end"
          side="top"
          sideOffset={8}
          className="w-[min(16.5rem,calc(100vw-1.5rem))] rounded-[var(--radius-lg)] p-3"
        >
          {details}
        </HoverCardContent>
      </HoverCard>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={accessibleLabel}
        className={triggerClassName}
      >
        {triggerContent}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-[min(16.5rem,calc(100vw-1.5rem))] rounded-[var(--radius-lg)] p-3"
      >
        {details}
      </PopoverContent>
    </Popover>
  );
}

function useAgentSessionTokenRequest(agentApi: string) {
  const { getAccessToken } = useAccessToken();
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;

  return useCallback(
    async (
      operation: "start-session" | "access-token",
      clientData?: AgentChatClientInput,
    ) => {
      await getAccessTokenRef.current();
      const response = await fetch(agentApi, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation,
          ...(operation === "start-session" ? { clientData } : {}),
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        publicAccessToken?: string;
        error?: string;
      } | null;

      if (!response.ok || !result?.publicAccessToken) {
        throw new Error(
          result?.error ??
            (operation === "start-session"
              ? "Could not start the agent chat."
              : "Could not refresh the agent chat token."),
        );
      }

      return result.publicAccessToken;
    },
    [agentApi],
  );
}

function ExistingSessionThreadChat(props: ThreadChatProps) {
  const agentApi = `/api/project/${encodeURIComponent(props.projectId)}/thread/${encodeURIComponent(props.threadId)}/agent`;
  const requestAgentSessionToken = useAgentSessionTokenRequest(agentApi);
  const [publicAccessToken, setPublicAccessToken] = useState<string>();
  const retryAttemptRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const loadToken = async () => {
      try {
        const token = await requestAgentSessionToken("access-token");
        if (!cancelled) {
          retryAttemptRef.current = 0;
          setPublicAccessToken(token);
        }
      } catch (tokenError) {
        if (cancelled) {
          return;
        }

        console.error("Failed to hydrate Trigger.dev chat session", tokenError);
        const delay = triggerSessionReconnectDelayMs(retryAttemptRef.current);
        retryAttemptRef.current += 1;
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          void loadToken();
        }, delay);
      }
    };

    const retryNow = () => {
      if (retryTimer === undefined) {
        return;
      }
      clearTimeout(retryTimer);
      retryTimer = undefined;
      void loadToken();
    };

    void loadToken();
    globalThis.addEventListener?.("online", retryNow);

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      globalThis.removeEventListener?.("online", retryNow);
    };
  }, [requestAgentSessionToken]);

  return (
    <ThreadChatRuntime
      key={publicAccessToken ?? "waiting-for-session-token"}
      {...props}
      disabled={props.disabled || !publicAccessToken}
      initialSessionToken={publicAccessToken}
      resumeSession={Boolean(publicAccessToken)}
      usingSessionTransport
    />
  );
}

export function ThreadChat(props: ThreadChatProps) {
  // A legacy run that was already active when the page mounted must finish
  // on its run-scoped stream. New threads and known Sessions use the durable
  // session transport for the lifetime of this mount.
  const usingSessionTransportRef = useRef<boolean | null>(null);
  usingSessionTransportRef.current ??= shouldUseTriggerSessionTransport({
    sessionCreatedAt: props.thread?.triggerSessionCreatedAt,
    currentRunId: props.currentRunId,
  });
  const existingSessionAtMountRef = useRef(
    Boolean(props.thread?.triggerSessionCreatedAt),
  );

  if (!usingSessionTransportRef.current) {
    return <ThreadChatRuntime {...props} usingSessionTransport={false} />;
  }

  if (existingSessionAtMountRef.current) {
    return <ExistingSessionThreadChat {...props} />;
  }

  return <ThreadChatRuntime {...props} usingSessionTransport />;
}

function ThreadChatRuntime({
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
  diffDeepLink,
  demoRecordingExperimentEnabled,
  onDiffPanelOpenChange,
  onDiffCountChange,
  project,
  thread,
  usingSessionTransport,
  initialSessionToken,
  resumeSession = false,
}: ThreadChatProps & {
  usingSessionTransport: boolean;
  initialSessionToken?: string;
  resumeSession?: boolean;
}) {
  const activeRunIdRef = useRef(currentRunId);
  const activeRunStartedAtRef = useRef<number | undefined>(undefined);
  const resumedRunIdsRef = useRef<Set<string>>(null!);
  resumedRunIdsRef.current ??= new Set<string>();
  const sessionResumeRequestedRef = useRef(false);
  const sessionStopRequestedRef = useRef(false);
  const sessionTurnCompletedRef = useRef(false);
  const sessionReconnectAttemptRef = useRef(0);
  const sessionReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sessionWasLiveRef = useRef(Boolean(thread?.isLive));
  const sessionThreadStateRef = useRef({
    isLive: Boolean(thread?.isLive),
    lastEventId: thread?.triggerSessionLastEventId as string | undefined,
  });
  sessionThreadStateRef.current = {
    isLive: Boolean(thread?.isLive),
    lastEventId: thread?.triggerSessionLastEventId,
  };
  const hasAutoSubmittedInitialPromptRef = useRef(false);
  const pendingStopRef = useRef<Promise<void> | null>(null);
  const pendingDemoSaveRef = useRef<Promise<boolean> | null>(null);
  const changedFileRequestRef = useRef(0);
  const [diffPromptContexts, setDiffPromptContexts] = useState<DiffPromptContext[]>([]);
  const [diffPanelMaximized, setDiffPanelMaximized] = useState(false);
  const [selectedDiffLink, setSelectedDiffLink] = useState<ThreadDiffDeepLink | undefined>();
  const addDiffPromptContext = useCallback((context: DiffPromptContext) => {
    setDiffPromptContexts((current) => current.some((item) => item.id === context.id)
      ? current
      : [...current, context]);
  }, []);
  const removeDiffPromptContext = useCallback((id: string) => {
    setDiffPromptContexts((current) => current.filter((context) => context.id !== id));
  }, []);
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
  const { getAccessToken: getWorkOSAccessToken } = useAccessToken();
  const getWorkOSAccessTokenRef = useRef(getWorkOSAccessToken);
  getWorkOSAccessTokenRef.current = getWorkOSAccessToken;

  if (!usingSessionTransport && currentRunId) {
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

  const requestAgentSessionToken = useAgentSessionTokenRequest(agentApi);

  const sessionFetch = useCallback(
    async (url: string, init: RequestInit, context: { endpoint: "in" | "out" }) => {
      if (context.endpoint === "out") {
        return await globalThis.fetch(url, init);
      }

      await getWorkOSAccessTokenRef.current();
      const headers = new Headers(init.headers);
      headers.set(AGENT_CHAT_OPERATION_HEADER, "append");

      return await globalThis.fetch(agentApi, {
        ...init,
        headers,
        credentials: "same-origin",
      });
    },
    [agentApi],
  );

  const handleSessionTransportEvent = useCallback(
    (event: ChatTransportEvent) => {
      if (event.chatId !== threadId) {
        return;
      }

      if (
        event.type === "message-sent" &&
        (event.source === "submit-message" || event.source === "regenerate-message")
      ) {
        sessionStopRequestedRef.current = false;
        sessionTurnCompletedRef.current = false;
        sessionReconnectAttemptRef.current = 0;
        activeRunStartedAtRef.current ??= event.timestamp;
      } else if (event.type === "stream-connected" || event.type === "first-chunk") {
        sessionReconnectAttemptRef.current = 0;
      } else if (event.type === "turn-completed") {
        sessionTurnCompletedRef.current = true;
        sessionReconnectAttemptRef.current = 0;
        if (sessionReconnectTimerRef.current) {
          clearTimeout(sessionReconnectTimerRef.current);
          sessionReconnectTimerRef.current = undefined;
        }
        activeRunStartedAtRef.current = undefined;
      }
    },
    [threadId],
  );

  const sessionClientData = useMemo<AgentChatClientInput>(
    () => ({
      ...(selectedModel ? { model: selectedModel } : {}),
      reasoningEffort: selectedReasoningEffort,
    }),
    [selectedModel, selectedReasoningEffort],
  );

  const sessionTransport = useTriggerChatTransport({
    task: AGENT_CHAT_TASK_ID,
    clientData: sessionClientData,
    sessions: initialSessionToken
      ? {
          [threadId]: triggerSessionHydration(
            initialSessionToken,
            thread?.triggerSessionLastEventId,
          ),
        }
      : undefined,
    accessToken: async () =>
      await requestAgentSessionToken("access-token"),
    startSession: async ({ clientData }) => ({
      publicAccessToken: await requestAgentSessionToken(
        "start-session",
        clientData as AgentChatClientInput,
      ),
    }),
    fetch: sessionFetch,
    onEvent: handleSessionTransportEvent,
  });
  const [sessionReconnectTick, setSessionReconnectTick] = useState(0);

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

  const legacyTransport = useMemo(
    () =>
      new TriggerChatTransport<UIMessage>({
        api: agentApi,
        onChatSendMessage: handleChatSendMessage,
        onChatEnd: handleChatEnd,
        prepareSendMessagesRequest: async (options) => {
          // Ensure the token is usable without rotating the WorkOS session on
          // every prompt. Forced rotation can briefly disturb active queries
          // and race AuthKit's focus/visibility session checks.
          await getWorkOSAccessToken();

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
      getWorkOSAccessToken,
      selectedModel,
      selectedReasoningEffort,
    ],
  );
  const transport = usingSessionTransport ? sessionTransport : legacyTransport;

  const { messages, setMessages, sendMessage, resumeStream, status, stop, error, clearError } = useChat<UIMessage>({
    id: threadId,
    messages: initialMessages,
    transport,
    resume: usingSessionTransport && resumeSession,
    experimental_throttle: 50,
    onError: (chatError) => {
      if (!isExpectedStreamAbort(chatError)) {
        // useChat records the error after this callback returns. Re-throwing
        // here rejects the submit lifecycle and can escape route boundaries.
        console.error("Agent chat stream failed", chatError);
      }
    },
  });
  const serverStreaming = usingSessionTransport
    ? Boolean(thread?.isLive)
    : Boolean(currentRunId);
  const allowPersistedPartRemoval = status === "ready" && !serverStreaming;

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
  const handleSelectChangedFile = useCallback((file: ThreadChangedFile) => {
    changedFileRequestRef.current += 1;
    setSelectedDiffLink({
      entryId: file.entry.id,
      file: file.entry.file,
      requestId: changedFileRequestRef.current,
    });
    onDiffPanelOpenChange(true);
  }, [onDiffPanelOpenChange]);
  useEffect(() => {
    onDiffCountChange(diffEntries.length);
  }, [diffEntries.length, onDiffCountChange]);

  useEffect(() => {
    const isLive = Boolean(thread?.isLive);

    if (!isLive) {
      sessionResumeRequestedRef.current = false;
      sessionStopRequestedRef.current = false;
      sessionTurnCompletedRef.current = false;
      sessionReconnectAttemptRef.current = 0;
      if (sessionReconnectTimerRef.current) {
        clearTimeout(sessionReconnectTimerRef.current);
        sessionReconnectTimerRef.current = undefined;
      }
    } else if (!sessionWasLiveRef.current) {
      sessionTurnCompletedRef.current = false;
      sessionReconnectAttemptRef.current = 0;
    }

    sessionWasLiveRef.current = isLive;
  }, [thread?.isLive]);

  useEffect(() => {
    if (
      !usingSessionTransport ||
      !resumeSession ||
      !thread?.isLive ||
      (status !== "ready" && status !== "error") ||
      sessionResumeRequestedRef.current ||
      sessionStopRequestedRef.current ||
      sessionTurnCompletedRef.current ||
      sessionReconnectTimerRef.current
    ) {
      return;
    }

    let cancelled = false;
    const delay = triggerSessionReconnectDelayMs(
      sessionReconnectAttemptRef.current,
    );
    sessionReconnectAttemptRef.current += 1;
    sessionReconnectTimerRef.current = setTimeout(() => {
      sessionReconnectTimerRef.current = undefined;
      sessionResumeRequestedRef.current = true;

      if (status === "error") {
        clearError();
      }

      const currentSession = sessionTransport.getSession(threadId);
      if (currentSession) {
        sessionTransport.setSession(threadId, {
          ...currentSession,
          isStreaming: true,
        });
      }

      void runTriggerSessionReconnectAttempt({
        resume: resumeStream,
        isSessionLive: () => sessionThreadStateRef.current.isLive,
        isTurnCompleted: () => sessionTurnCompletedRef.current,
      }).then(({ error: resumeError, shouldRetry }) => {
        sessionResumeRequestedRef.current = false;

        if (cancelled) {
          return;
        }

        if (resumeError) {
          console.error("Failed to resume Trigger.dev chat session", resumeError);
        }

        if (shouldRetry) {
          // The server can fast-close a reconnect while a freshly-started
          // turn has not appended its first output record yet. Try again
          // without competing with the transport's own in-stream retries.
          clearError();
          setSessionReconnectTick((tick) => tick + 1);
        }
      });
    }, delay);

    return () => {
      cancelled = true;
      if (sessionReconnectTimerRef.current) {
        clearTimeout(sessionReconnectTimerRef.current);
        sessionReconnectTimerRef.current = undefined;
      }
    };
  }, [
    clearError,
    resumeSession,
    resumeStream,
    sessionReconnectTick,
    sessionTransport,
    status,
    thread?.isLive,
    threadId,
    usingSessionTransport,
  ]);

  useEffect(() => {
    if (
      usingSessionTransport ||
      !currentRunId ||
      status !== "ready" ||
      resumedRunIdsRef.current.has(currentRunId)
    ) {
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
  }, [
    currentRunId,
    hasPersistedLastAssistantMessage,
    resumeStream,
    status,
    usingSessionTransport,
  ]);

  const busy = status === "submitted" || status === "streaming";
  const ready = status === "ready" && !disabled && !serverStreaming;
  if ((serverStreaming || busy) && !activeRunStartedAtRef.current) {
    activeRunStartedAtRef.current = Date.now();
  }
  if (
    !busy &&
    !serverStreaming &&
    !activeRunIdRef.current &&
    activeRunStartedAtRef.current
  ) {
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

    if (usingSessionTransport) {
      sessionStopRequestedRef.current = true;
    }
    const sessionStop = usingSessionTransport
      ? sessionTransport.stopGeneration(threadId)
      : null;

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

    if (sessionStop) {
      const stopPromise = sessionStop
        .then(() => undefined)
        .catch((stopError) => {
          console.error("Failed to stop Trigger.dev chat session", stopError);
        })
        .finally(() => {
          if (pendingStopRef.current === stopPromise) {
            pendingStopRef.current = null;
          }
        });

      pendingStopRef.current = stopPromise;
      return;
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
  }, [
    clearError,
    getRunApi,
    messages,
    sessionTransport,
    setMessages,
    stop,
    threadId,
    usingSessionTransport,
  ]);
  const toggleDemoEnabled = useCallback(async () => {
    const optimisticDemoEnabled = pendingDemoEnabled ?? Boolean(thread?.demoEnabled);

    if (!demoRecordingExperimentEnabled && !optimisticDemoEnabled) {
      return;
    }

    const nextDemoEnabled = !optimisticDemoEnabled;
    setPendingDemoEnabled(nextDemoEnabled);
    setDemoSaving(true);

    const savePromise = setDemoEnabled({ threadId, demoEnabled: nextDemoEnabled })
      .then(() => true)
      .catch((toggleError) => {
        setPendingDemoEnabled(undefined);
        console.error("Failed to update demo mode", toggleError);
        return false;
      });
    pendingDemoSaveRef.current = savePromise;

    try {
      await savePromise;
    } finally {
      if (pendingDemoSaveRef.current === savePromise) {
        pendingDemoSaveRef.current = null;
      }
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
  const threadTotalProcessedTokens = useMemo(() => {
    return messages.reduce((total, message) => {
      if (message.role !== "assistant") {
        return total;
      }

      return total + (getAssistantRunUsage(message.metadata)?.totalTokens ?? 0);
    }, 0);
  }, [messages]);
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
    const nextMessage = appendDiffPromptContexts(text, diffPromptContexts);

    if ((!nextMessage && files.length === 0) || disabled || serverStreaming) {
      return;
    }

    if (pendingStopRef.current) {
      await pendingStopRef.current;
    }

    const pendingDemoSave = pendingDemoSaveRef.current;
    if (pendingDemoSave && !(await pendingDemoSave)) {
      return;
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
      setDiffPromptContexts([]);
      return;
    }

    if (!nextMessage) {
      return;
    }

    await sendMessage({ text: nextMessage });
    setDiffPromptContexts([]);
  }, [clearError, diffPromptContexts, disabled, imageUploads, sendMessage, serverStreaming, status]);

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
        id="thread-chat-panel"
        className={cn(
          "h-full min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden transition-opacity duration-200 ease-out motion-reduce:transition-none",
          diffPanelOpen ? "hidden lg:grid" : "grid",
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
            diffEntries={diffEntries}
            onSelectChangedFile={handleSelectChangedFile}
          />
        </div>

        <div className="relative min-w-0 bg-background px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:px-8">
          <div className="mx-auto w-full min-w-0 max-w-[680px]">
            <AgentRunIssuePanel issue={thread?.agentRunIssue ?? thread?.workflowIssue} />
            <PromptInputProvider>
              <PromptInput
                className="min-w-0 max-w-full"
                accept="image/*"
                clearOnSubmit="submit"
                multiple
                onSubmit={(message) => submitMessage(message)}
              >
                <CodexPromptConnectionLine
                  issue={codexPromptIssue}
                  className="rounded-t-[var(--radius-xxl)] border-b-border/40 bg-transparent px-3.5"
                />
                <PromptInputHeader>
                  <DiffPromptContextChips
                    contexts={diffPromptContexts}
                    onRemove={removeDiffPromptContext}
                  />
                  <PromptImageAttachments
                    disabled={!ready}
                    manager={imageUploads}
                  />
                </PromptInputHeader>
                <PromptInputBody>
                  <ThreadChatTextarea disabled={!ready} />
                </PromptInputBody>
                <PromptInputFooter className="min-w-0 gap-1.5">
                  <PromptInputTools className="min-w-0 flex-1 gap-1">
                    <Select
                      value={selectedModel ?? ""}
                      onValueChange={(value) => value && setSelectedModelChoice(value)}
                    >
                      <SelectTrigger
                        size="sm"
                        className={promptControlTriggerClassName}
                        disabled={!ready || modelOptions.length === 0}
                        aria-label="Model"
                      >
                        <CodexLogo className="size-4 shrink-0" />
                        <SelectValue>
                          <span className="truncate">{formatCodexModelLabel(selectedModel)}</span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent
                        align="start"
                        alignItemWithTrigger={false}
                        side="top"
                        sideOffset={8}
                        className="w-[min(18rem,calc(100vw-2rem))] min-w-0 rounded-[var(--radius-xl)] p-1.5 shadow-lg"
                      >
                        {modelOptions.map((model) => (
                          <SelectItem
                            key={model}
                            value={model}
                            className="rounded-[var(--radius-lg)] py-2.5 pr-8 pl-2.5 text-sm"
                          >
                            <CodexLogo className="size-4 text-muted-foreground" />
                            <span className="min-w-0 truncate font-medium text-foreground/90">
                              {formatCodexModelLabel(model)}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <button
                            type="button"
                            aria-label="Composer options"
                            className="inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-muted/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        side="top"
                        sideOffset={8}
                        className="w-52 rounded-[var(--radius-xl)] p-1.5 shadow-lg"
                      >
                        <DropdownMenuGroup>
                          <DropdownMenuLabel className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.12em]">
                            Reasoning
                          </DropdownMenuLabel>
                          <DropdownMenuRadioGroup
                            value={selectedReasoningEffort}
                            onValueChange={(value) => setSelectedReasoningEffort(value as CodexReasoningEffort)}
                          >
                            {selectedReasoningEfforts.map((effort) => (
                              <DropdownMenuRadioItem
                                key={effort}
                                value={effort}
                                disabled={!ready}
                                className="rounded-[var(--radius-md)] py-2 text-sm"
                              >
                                {getCodexReasoningEffortLabel(effort)}
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuGroup>
                        {demoRecordingExperimentEnabled ? (
                          <>
                            <DropdownMenuSeparator className="my-1" />
                            <DropdownMenuCheckboxItem
                              checked={optimisticDemoEnabled}
                              disabled={demoSaving}
                              onCheckedChange={() => void toggleDemoEnabled()}
                              className="rounded-[var(--radius-md)] py-2 text-sm"
                            >
                              <Video className="size-4 text-muted-foreground" aria-hidden="true" />
                              Record demo
                            </DropdownMenuCheckboxItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <PromptImageUploadButton disabled={!ready} />
                    <span className="min-w-0 flex-1" />
                    <ThreadContextWindowIndicator
                      usage={currentContextUsage}
                      totalProcessedTokens={threadTotalProcessedTokens}
                      contextLimit={selectedModelContextLimit}
                    />
                  </PromptInputTools>
                  <PromptInputSubmit
                    className="size-9 lg:size-8"
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
        open={diffPanelOpen}
        onOpenChange={onDiffPanelOpenChange}
        isLoading={status === "submitted" || status === "streaming"}
        projectId={projectId}
        threadId={threadId}
        threadTitle={thread?.title}
        baseBranch={thread?.baseBranch ?? project?.currentBranch ?? project?.repoBranch ?? project?.defaultBranch}
        featureBranch={thread?.featureBranch}
        pullRequestStatus={thread?.pullRequestStatus}
        pullRequestUrl={thread?.pullRequestUrl}
        pullRequestNumber={thread?.pullRequestNumber}
        pullRequestBranch={thread?.pullRequestBranch}
        pullRequestError={thread?.pullRequestError}
        maximized={showMaximizedDiffPanel}
        onMaximizedChange={setDiffPanelMaximized}
        onAddPromptContext={addDiffPromptContext}
        deepLink={diffDeepLink ?? selectedDiffLink}
      />
    </section>
  );
}
