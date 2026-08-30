import { useChat } from "@ai-sdk/react";
import { api } from "@autopr/backend/convex/_generated/api";
import { isTemporaryThreadFeatureBranch } from "@autopr/backend/convex/lib/threadWorktree";
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
import { CircleAlert, GitBranch, Loader2, MoreHorizontal, Video, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { FileTypeIcon } from "#/lib/file-type-icon";
import { TriggerChatTransport } from "#/lib/trigger-chat-transport";
import { UIMessageStreamProtocolTransport } from "#/lib/ui-message-stream-protocol";
import {
  AGENT_CHAT_OPERATION_HEADER,
  AGENT_CHAT_TASK_ID,
  type AgentChatClientInput,
} from "#/lib/trigger-agent-contract";
import { setWorkOSAccessTokenHeader } from "#/lib/workos-access-token";
import {
  restorePersistedAssistantTail,
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
import { AgentModelPicker } from "#/components/agent-model-picker";
import { ThreadDiffPanel } from "#/components/thread/thread-diff-panel";
import { activeThreadComputerActivityKey } from "#/components/thread/thread-computer-activity";
import { ThreadComputerPreview } from "#/components/thread/thread-computer-preview";
import { ThreadMessages } from "#/components/thread/thread-messages";
import {
  latestSubAgentActivity,
  ThreadSubAgentActivityPanel,
} from "#/components/thread/thread-sub-agent-activity";
import {
  getCodexReasoningEffortLabel,
  type CodexModelId,
  type CodexReasoningEffort,
} from "#/lib/codex-models";
import {
  agentModelKey,
  getAgentContextLimit,
  getAgentModelOptions,
  getAgentReasoningEfforts,
  selectAgentModel,
  selectAgentReasoningEffort,
  type AgentProvider,
} from "#/lib/agent-models";
export { CODEX_MODELS, DEFAULT_CODEX_MODEL, isCodexModelId } from "#/lib/codex-models";
export type { CodexModelId, CodexReasoningEffort } from "#/lib/codex-models";
import {
  appendDiffPromptContexts,
  formatDiffPromptContextLabel,
  type DiffPromptContext,
  type ThreadChangedFile,
  type ThreadChangedFileSummary,
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
import { fetchThreadGitFileDiff } from "#/lib/thread-git-diff";
import { useThreadGitStatusQuery } from "#/lib/thread-git-status-query";
import {
  DEFAULT_THREAD_TITLE,
  firstUserMessageForTitle,
  MAX_THREAD_TITLE_REQUEST_ATTEMPTS,
  requestGeneratedThreadTitle,
  threadTitleRetryDelayMs,
  ThreadTitleRequestError,
} from "#/lib/thread-title-generation";

type ThreadChatProps = {
  projectId: string;
  threadId: string;
  currentRunId?: string;
  initialMessages: UIMessage[];
  initialPrompt?: string;
  initialProvider?: AgentProvider;
  initialModel?: CodexModelId;
  initialReasoningEffort?: CodexReasoningEffort;
  availableCodexModels?: string[];
  availableGrokModels?: string[];
  disabled: boolean;
  codexPromptIssue?: CodexPromptConnectionIssue;
  diffPanelOpen: boolean;
  diffDeepLink?: ThreadDiffDeepLink;
  demoRecordingExperimentEnabled: boolean;
  onDiffPanelOpenChange: (open: boolean) => void;
  onDiffCountChange: (count: number) => void;
  project?: any;
  thread?: any;
  gitStatusEnabled?: boolean;
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
  "max-w-[48vw] lg:max-w-[12rem]";

function ThreadChatTextarea({ disabled }: { disabled: boolean }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="relative w-full min-w-0">
      <PromptInputTextarea
        ref={textareaRef}
        disabled={disabled}
        placeholder="Add a follow up..."
        className="max-h-50 min-h-[4.375rem] resize-none px-4 py-3 text-[14px] leading-relaxed"
      />
    </div>
  );
}

function ComposerBranchIndicator({
  branch,
  expectedBranch,
  isFetching,
  readFailed,
  onRefresh,
}: {
  branch?: string;
  expectedBranch?: string;
  isFetching: boolean;
  readFailed: boolean;
  onRefresh: () => void;
}) {
  const mismatch = Boolean(branch && expectedBranch && branch !== expectedBranch);
  const showLoading = isFetching && !branch;
  const label = branch ?? (showLoading ? "Reading branch…" : "Unknown branch");
  const description = mismatch
    ? `Daytona has ${branch} checked out; this thread expects ${expectedBranch}.`
    : readFailed
      ? `Could not verify the Daytona checkout. Last known branch: ${label}.`
      : `Daytona checkout: ${label}.`;

  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={isFetching}
      aria-label={`${description} Refresh branch.`}
      title={description}
      className={cn(
        "inline-flex h-7 min-w-0 max-w-[18rem] shrink items-center gap-1.5 rounded-[var(--radius-md)] px-2 font-mono text-[11px] font-medium transition-colors",
        "text-muted-foreground/75 hover:bg-muted/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 disabled:cursor-wait",
        (mismatch || readFailed) && "text-amber-600 dark:text-amber-400",
      )}
    >
      {showLoading ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
      ) : mismatch || readFailed ? (
        <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <GitBranch className="size-3.5 shrink-0 opacity-80" aria-hidden="true" />
      )}
      <span className="min-w-0 truncate">{label}</span>
    </button>
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
      const workOSAccessToken = await getAccessTokenRef.current();
      const headers = setWorkOSAccessTokenHeader(
        new Headers({ "Content-Type": "application/json" }),
        workOSAccessToken,
      );
      const response = await fetch(agentApi, {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({
          operation,
          ...(operation === "start-session" ? { clientData } : {}),
        }),
      });
      type SessionTokenResult = {
        publicAccessToken?: string;
        error?: string;
      };

      if (!response.ok) {
        const errorResult = (await response.json().catch(() => null)) as
          | SessionTokenResult
          | null;
        throw new Error(
          errorResult?.error ??
            (operation === "start-session"
              ? "Could not start the agent chat."
              : "Could not refresh the agent chat token."),
        );
      }

      const result = (await response.json().catch(() => null)) as
        | SessionTokenResult
        | null;

      if (!result?.publicAccessToken) {
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
  // Task runs are the cross-client transport: mobile and web can both consume
  // their indexed stream. Keep support for an already-active durable Session
  // turn, then switch back to task transport as soon as that turn settles.
  const usingSessionTransport = shouldUseTriggerSessionTransport({
    sessionCreatedAt: props.thread?.triggerSessionCreatedAt,
    currentRunId: props.currentRunId,
    currentRunTransport: props.thread?.currentRunTransport,
  });

  if (!usingSessionTransport) {
    return (
      <ThreadChatRuntime
        key="task-transport"
        {...props}
        usingSessionTransport={false}
      />
    );
  }

  return <ExistingSessionThreadChat key="session-transport" {...props} />;
}

function ThreadChatRuntime({
  projectId,
  threadId,
  currentRunId,
  initialMessages,
  initialPrompt,
  initialProvider,
  initialModel,
  initialReasoningEffort,
  availableCodexModels,
  availableGrokModels,
  disabled,
  codexPromptIssue,
  diffPanelOpen,
  diffDeepLink,
  demoRecordingExperimentEnabled,
  onDiffPanelOpenChange,
  onDiffCountChange,
  thread,
  gitStatusEnabled = true,
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
  const workspaceDiffRequestRef = useRef(0);
  const [diffPromptContexts, setDiffPromptContexts] = useState<DiffPromptContext[]>([]);
  const [workspaceDiffEntries, setWorkspaceDiffEntries] = useState<ThreadDiffEntry[]>([]);
  const [workspaceDiffLoadingFile, setWorkspaceDiffLoadingFile] = useState<string>();
  const [workspaceDiffError, setWorkspaceDiffError] = useState<Error>();
  const [diffPanelMaximized, setDiffPanelMaximized] = useState(false);
  const [selectedDiffLink, setSelectedDiffLink] = useState<ThreadDiffDeepLink | undefined>();
  const composerGitStatusQuery = useThreadGitStatusQuery({
    projectId,
    threadId,
    persistedStatus: thread?.gitStatus,
    enabled: gitStatusEnabled,
    refetchInterval: false,
  });
  const addDiffPromptContext = useCallback((context: DiffPromptContext) => {
    setDiffPromptContexts((current) => current.some((item) => item.id === context.id)
      ? current
      : [...current, context]);
  }, []);
  const removeDiffPromptContext = useCallback((id: string) => {
    setDiffPromptContexts((current) => current.filter((context) => context.id !== id));
  }, []);
  const modelOptions = useMemo(
    () => getAgentModelOptions({ codexModels: availableCodexModels, grokModels: availableGrokModels }),
    [availableCodexModels, availableGrokModels],
  );
  const [selectedModelChoice, setSelectedModelChoice] = useState<string | undefined>(() =>
    initialProvider && initialModel ? agentModelKey({ provider: initialProvider, modelId: initialModel }) : undefined,
  );
  const setAgentModelSelection = useMutation(api.threads.setAgentModelSelection);
  const selectedModel = useMemo(() => {
    const requested = modelOptions.find((option) => option.key === selectedModelChoice)
      ?? (initialModel ? { provider: initialProvider ?? "openai-codex" as const, modelId: initialModel } : undefined);
    return selectAgentModel(modelOptions, requested);
  }, [initialModel, initialProvider, modelOptions, selectedModelChoice]);
  const [selectedReasoningEffortChoice, setSelectedReasoningEffortChoice] = useState<CodexReasoningEffort | undefined>(
    initialReasoningEffort,
  );
  const [pendingDemoEnabled, setPendingDemoEnabled] = useState<boolean | undefined>();
  const [demoSaving, setDemoSaving] = useState(false);
  const imageUploads = usePromptImageUploadManager();
  const selectedReasoningEfforts = useMemo(() => getAgentReasoningEfforts(selectedModel), [selectedModel]);
  const selectedReasoningEffort = selectAgentReasoningEffort(selectedModel, selectedReasoningEffortChoice);
  const setDemoEnabled = useMutation(api.threads.setDemoEnabled);
  const { getAccessToken: getWorkOSAccessToken } = useAccessToken();
  const getWorkOSAccessTokenRef = useRef(getWorkOSAccessToken);
  getWorkOSAccessTokenRef.current = getWorkOSAccessToken;

  const handleModelSelectionChange = useCallback((value: string) => {
    const model = modelOptions.find((option) => option.key === value);
    if (!model) return;

    setSelectedModelChoice(value);
    void setAgentModelSelection({
      threadId,
      provider: model.provider,
      model: model.modelId,
    }).catch((selectionError) => {
      console.error("Could not save the thread model selection", selectionError);
    });
  }, [modelOptions, setAgentModelSelection, threadId]);

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

      const workOSAccessToken = await getWorkOSAccessTokenRef.current();
      const headers = new Headers(init.headers);
      headers.set(AGENT_CHAT_OPERATION_HEADER, "append");
      setWorkOSAccessTokenHeader(headers, workOSAccessToken);

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
      ...(selectedModel ? { provider: selectedModel.provider, model: selectedModel.modelId } : {}),
      ...(selectedReasoningEffort ? { reasoningEffort: selectedReasoningEffort } : {}),
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
              ...(selectedModel ? { provider: selectedModel.provider, model: selectedModel.modelId } : {}),
              ...(selectedReasoningEffort ? { reasoningEffort: selectedReasoningEffort } : {}),
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
  // Both Trigger transports can resume at a durable chunk boundary. Normalize
  // text-part lifecycles before AI SDK consumes either stream.
  const selectedTransport = usingSessionTransport ? sessionTransport : legacyTransport;
  const transport = useMemo(
    () => new UIMessageStreamProtocolTransport<UIMessage>(selectedTransport),
    [selectedTransport],
  );

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
  const firstUserTitleMessage = useMemo(
    () => firstUserMessageForTitle(messages),
    [messages],
  );
  const [titleGenerationRetry, setTitleGenerationRetry] = useState({
    threadId,
    attempt: 0,
  });
  const titleGenerationAttempt = titleGenerationRetry.threadId === threadId
    ? titleGenerationRetry.attempt
    : 0;

  useEffect(() => {
    const hasTemporaryBranch = isTemporaryThreadFeatureBranch(thread?.featureBranch, threadId);
    if (
      (thread?.title !== DEFAULT_THREAD_TITLE && !hasTemporaryBranch)
      || !firstUserTitleMessage
      || titleGenerationAttempt >= MAX_THREAD_TITLE_REQUEST_ATTEMPTS
    ) {
      return;
    }

    const controller = new AbortController();
    const retryTimer = setTimeout(() => {
      void requestGeneratedThreadTitle({
        projectId,
        threadId,
        message: firstUserTitleMessage,
        signal: controller.signal,
      }).catch((titleError) => {
        if (controller.signal.aborted) return;

        console.error("Could not generate the thread title", {
          message: titleError instanceof Error ? titleError.message : String(titleError),
          attempt: titleGenerationAttempt + 1,
        });
        setTitleGenerationRetry({
          threadId,
          attempt: titleError instanceof ThreadTitleRequestError && !titleError.retryable
            ? MAX_THREAD_TITLE_REQUEST_ATTEMPTS
            : titleGenerationAttempt + 1,
        });
      });
    }, threadTitleRetryDelayMs(titleGenerationAttempt));

    return () => {
      clearTimeout(retryTimer);
      controller.abort();
    };
  }, [
    firstUserTitleMessage,
    projectId,
    thread?.title,
    thread?.featureBranch,
    threadId,
    titleGenerationAttempt,
  ]);

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
  const persistedDiffEntries = useMemo(() => extractThreadDiffEntries(messages), [messages]);
  const diffEntries = useMemo(() => [
    ...persistedDiffEntries,
    ...workspaceDiffEntries.filter((workspaceEntry) =>
      !persistedDiffEntries.some((entry) => entry.file === workspaceEntry.file)
    ),
  ], [persistedDiffEntries, workspaceDiffEntries]);
  const openChangedFile = useCallback((file: ThreadChangedFile) => {
    changedFileRequestRef.current += 1;
    setSelectedDiffLink({
      entryId: file.entry.id,
      file: file.entry.file,
      requestId: changedFileRequestRef.current,
    });
    onDiffPanelOpenChange(true);
  }, [onDiffPanelOpenChange]);
  const handleSelectChangedFile = useCallback(async (file: ThreadChangedFileSummary) => {
    if (file.changedFile) {
      workspaceDiffRequestRef.current += 1;
      setWorkspaceDiffLoadingFile(undefined);
      openChangedFile(file.changedFile);
      return;
    }

    const requestId = workspaceDiffRequestRef.current + 1;
    workspaceDiffRequestRef.current = requestId;
    setWorkspaceDiffLoadingFile(file.file);
    setWorkspaceDiffError(undefined);

    try {
      const diff = await fetchThreadGitFileDiff({ projectId, threadId, file: file.file });
      if (workspaceDiffRequestRef.current !== requestId) return;

      const latestAssistantMessage = [...messages]
        .reverse()
        .find((message) => message.role === "assistant");
      const entry: ThreadDiffEntry = {
        id: `workspace:${diff.file}`,
        messageId: latestAssistantMessage?.id ?? "workspace",
        partIndex: -1,
        turn: messages.length,
        tool: "edit",
        file: diff.file,
        patch: diff.patch,
        additions: file.additions,
        deletions: file.deletions,
        status: diff.status,
        diff: {
          renderer: "pierre",
          patch: diff.patch,
          patchOmitted: diff.patchOmitted,
          status: diff.status,
        },
      };

      setWorkspaceDiffEntries((current) => [
        ...current.filter((candidate) => candidate.id !== entry.id),
        entry,
      ]);
      openChangedFile({ entry, additions: file.additions, deletions: file.deletions });
    } catch (diffError) {
      if (workspaceDiffRequestRef.current !== requestId) return;
      setWorkspaceDiffError(diffError instanceof Error
        ? diffError
        : new Error("Could not open the file diff."));
    } finally {
      if (workspaceDiffRequestRef.current === requestId) {
        setWorkspaceDiffLoadingFile(undefined);
      }
    }
  }, [messages, openChangedFile, projectId, threadId]);
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
        // A completed AI SDK stream parser cannot resume in the middle of an
        // active text/tool part. Rewind Trigger to the last persisted turn
        // boundary and remove only this turn's unpersisted assistant tail so
        // the replay includes every required start chunk.
        const currentSession = sessionTransport.getSession(threadId);
        if (currentSession) {
          sessionTransport.setSession(threadId, {
            ...currentSession,
            lastEventId: thread?.triggerSessionLastEventId,
            isStreaming: true,
          });
        }
        setMessages((currentMessages) =>
          restorePersistedAssistantTail(currentMessages, initialMessages)
        );
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
    initialMessages,
    sessionReconnectTick,
    sessionTransport,
    setMessages,
    status,
    thread?.triggerSessionLastEventId,
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
  const activeAssistantMessageId = (busy || serverStreaming) && lastMessage?.role === "assistant"
    ? lastMessage.id
    : undefined;
  const activeComputerActivityKey = useMemo(
    () => activeThreadComputerActivityKey(messages, activeAssistantMessageId),
    [activeAssistantMessageId, messages],
  );
  const awaitingAgentResponse = status === "submitted" && !activeAssistantMessageId;
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
  const subAgentActivity = useMemo(
    () => latestSubAgentActivity(messages),
    [messages],
  );
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
  const selectedModelContextLimit = getAgentContextLimit(selectedModel);

  useEffect(() => {
    if (
      selectedModelChoice &&
      availableCodexModels !== undefined &&
      availableGrokModels !== undefined &&
      !modelOptions.some((option) => option.key === selectedModelChoice)
    ) {
      setSelectedModelChoice(undefined);
    }
  }, [availableCodexModels, availableGrokModels, modelOptions, selectedModelChoice]);

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
  }, [clearError, diffPromptContexts, disabled, imageUploads, projectId, sendMessage, serverStreaming, status, threadId]);

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
  const usesWorktree = thread?.workspaceMode === "worktree" || (
    thread?.workspaceMode === undefined && Boolean(thread?.featureBranch || thread?.worktreePath)
  );
  const composerGitStatus = composerGitStatusQuery.data ?? thread?.gitStatus;
  const checkedOutBranch = composerGitStatus?.detachedHead
    ? `detached@${composerGitStatus.localHeadSha?.slice(0, 7) ?? "HEAD"}`
    : composerGitStatus?.currentBranch;
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
          "relative h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-opacity duration-200 ease-out motion-reduce:transition-none",
          diffPanelOpen ? "hidden lg:flex" : "flex",
          showMaximizedDiffPanel && "lg:pointer-events-none lg:opacity-0",
        )}
        aria-hidden={showMaximizedDiffPanel || undefined}
      >
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <ThreadMessages
            keyedMessages={keyedMessages}
            ready={ready}
            error={error ?? workspaceDiffError}
            showingInitialPromptHandoff={showingInitialPromptHandoff}
            initialPrompt={initialPrompt}
            awaitingAgentResponse={awaitingAgentResponse}
            activeAssistantMessageId={activeAssistantMessageId}
            activeRunStartedAt={activeRunStartedAt}
            modelId={selectedModel?.modelId}
            recordingPlaybackBasePath={recordingPlaybackBasePath}
            onSubmitMessage={submitMessage}
            diffEntries={diffEntries}
            workspaceChangedFiles={composerGitStatus?.hasWorkingTreeChanges
              ? composerGitStatus.changedFiles
              : []}
            workspaceDiffLoadingFile={workspaceDiffLoadingFile}
            onSelectChangedFile={handleSelectChangedFile}
          />
          <ThreadComputerPreview
            key={threadId}
            projectId={projectId}
            activityKey={activeComputerActivityKey}
          />
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 min-w-0 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-10 sm:px-8">
          <div className="pointer-events-auto mx-auto w-full min-w-0 max-w-3xl">
            <AgentRunIssuePanel issue={thread?.agentRunIssue ?? thread?.workflowIssue} />
            <PromptInputProvider>
              {subAgentActivity ? (
                <ThreadSubAgentActivityPanel
                  key={subAgentActivity.messageId}
                  activity={subAgentActivity}
                />
              ) : null}
              <PromptInput
                className="autopr-chat-composer relative z-10 min-w-0 max-w-full"
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
                    <AgentModelPicker
                      models={modelOptions}
                      value={selectedModel ? agentModelKey(selectedModel) : ""}
                      onValueChange={handleModelSelectionChange}
                      triggerClassName={promptControlTriggerClassName}
                      disabled={!ready || modelOptions.length === 0}
                    />

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
                          {selectedReasoningEfforts.length > 0 ? <DropdownMenuGroup>
                            <DropdownMenuLabel className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.12em]">
                              Reasoning
                            </DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                              value={selectedReasoningEffort}
                              onValueChange={(value) => setSelectedReasoningEffortChoice(value as CodexReasoningEffort)}
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
                          </DropdownMenuGroup> : null}
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
              <div className="autopr-composer-context-strip relative z-0 -mt-4 mx-auto flex w-[calc(100%-2.75rem)] min-w-0 max-w-[calc(48rem-2.75rem)] items-center justify-end overflow-hidden px-2 pb-1 pt-5">
                <ComposerBranchIndicator
                  branch={checkedOutBranch}
                  expectedBranch={usesWorktree ? thread?.featureBranch : undefined}
                  isFetching={composerGitStatusQuery.isFetching}
                  readFailed={composerGitStatusQuery.isError}
                  onRefresh={() => void composerGitStatusQuery.refetch()}
                />
              </div>
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
        pullRequestNumber={thread?.pullRequestNumber}
        maximized={showMaximizedDiffPanel}
        onMaximizedChange={setDiffPanelMaximized}
        onAddPromptContext={addDiffPromptContext}
        deepLink={diffDeepLink ?? selectedDiffLink}
      />
    </section>
  );
}
