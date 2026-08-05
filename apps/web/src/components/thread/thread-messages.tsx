import type { GitChangedFile } from "@autopr/backend/convex/lib/gitStatus";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@autopr/ui/components/collapsible";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@autopr/ui/components/dialog";
import { cn } from "@autopr/ui/lib/utils";
import { getToolName, isFileUIPart, isReasoningUIPart, isTextUIPart, isToolUIPart, type UIMessage } from "ai";
import { Bot, Check, ChevronDown, Copy } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationMessage,
  ConversationMessageNavigation,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import {
  contextTokensFromUsage,
  formatRunCost,
  formatTokens,
  formatRunDuration,
  getAssistantRunCost,
  getAssistantRunUsage,
  readAssistantRunMetadata,
} from "#/lib/assistant-message-metadata";
import { calculateCodexUsageCost } from "#/lib/codex-models";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  ToolRecordingOutput,
  ExploreToolRow,
  isExploreTool,
  isComputerRecordingTool,
  toolSlugFromPart,
  type ToolPart,
} from "@/components/ai-elements/tool";
import { ThreadChangedFiles } from "./thread-changed-files";
import {
  changedFilesForMessage,
  mergeChangedFilesWithWorkspace,
  type ThreadChangedFile,
  type ThreadDiffEntry,
} from "./thread-diff-panel-utils";

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

function getTextParts(parts: UIMessage["parts"]) {
  const textParts: string[] = [];
  for (const part of parts) {
    if (!isTextUIPart(part)) {
      continue;
    }

    const text = part.text.trim();
    if (text) {
      textParts.push(text);
    }
  }
  return textParts.join("\n\n");
}

function useElapsedSeconds(startedAt: number | undefined) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === undefined) {
      return;
    }

    const interval = window.setInterval(() => setNow(Date.now()), 1000);

    return () => window.clearInterval(interval);
  }, [startedAt]);

  return startedAt === undefined
    ? undefined
    : Math.max(0, Math.floor((now - startedAt) / 1000));
}

async function writeClipboardText(text: string) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to the selection API below for browsers that reject async clipboard writes.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function UserMessageCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number>(0);

  const copyMessage = useCallback(async () => {
    if (!text) {
      return;
    }

    const didCopy = await writeClipboardText(text);
    if (!didCopy) {
      return;
    }

    setCopied(true);
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setCopied(false), 1600);
  }, [text]);

  useEffect(
    () => () => {
      window.clearTimeout(timeoutRef.current);
    },
    []
  );

  const Icon = copied ? Check : Copy;

  return (
    <MessageFooter className="mt-1 p-0 opacity-0 transition-opacity duration-150 group-hover/user-message:opacity-100 focus-within:opacity-100">
      <MessageActions>
        <MessageAction
          aria-label={copied ? "Copied message" : "Copy message"}
          className="size-6 disabled:cursor-not-allowed disabled:opacity-30"
          disabled={!text}
          label={copied ? "Copied message" : "Copy message"}
          onClick={() => void copyMessage()}
          tooltip={copied ? "Copied" : "Copy message"}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </MessageAction>
      </MessageActions>
    </MessageFooter>
  );
}

function ImageAttachmentPreview({
  alt,
  className,
  src,
}: {
  alt: string;
  className?: string;
  src: string;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className={cn(
              "block overflow-hidden rounded-[var(--radius-lg)] border border-border/50 bg-muted/30 transition hover:border-border/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40",
              className
            )}
            aria-label="Open image preview"
          />
        }
      >
        <img
          alt={alt}
          className="h-20 w-28 object-cover sm:h-24 sm:w-36"
          src={src}
        />
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-[var(--radius-xl)] border-border/60 bg-background p-0 sm:max-w-[calc(100vw-2rem)]" showCloseButton>
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        <div className="max-h-[calc(100vh-2rem)] overflow-auto bg-muted/30 p-2">
          <img
            alt={alt}
            className="mx-auto max-h-[calc(100vh-3rem)] w-auto max-w-full object-contain"
            src={src}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExploreToolGroup({
  defaultOpen = false,
  messageId,
  tools,
  summaryParts,
  anyStreaming,
}: {
  defaultOpen?: boolean;
  messageId: string;
  tools: { part: any; stableKey: string }[];
  summaryParts: string[];
  anyStreaming: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="my-1.5 w-full min-w-0 font-mono text-xs leading-tight text-muted-foreground/50">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="group/explore flex w-full cursor-pointer items-center gap-1.5 py-0.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
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
      <div className="mx-auto flex w-full min-w-0 max-w-[680px] justify-end px-6 py-3 sm:px-8">
        <div className="group/user-message relative w-fit max-w-[min(100%,36rem)]">
          <div className="rounded-[var(--radius-xxl)] border border-border/45 bg-muted/45 px-3.5 py-2.5 dark:bg-muted/30">
            <p className="break-words text-[14px] leading-[1.65] text-foreground [overflow-wrap:anywhere]">
              {prompt}
            </p>
          </div>
          <UserMessageCopyButton text={prompt} />
        </div>
      </div>
    </div>
  );
}

function AwaitingAgentIndicator({ startedAt }: { startedAt?: number }) {
  const elapsedSeconds = useElapsedSeconds(startedAt);

  return (
    <output aria-live="polite" aria-label="Agent is thinking">
      <div className="mx-auto max-w-[680px] px-6 py-2.5 sm:px-8">
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-muted-foreground/50 motion-safe:animate-[pulse_1s_cubic-bezier(0.16,1,0.3,1)_infinite] [animation-delay:-0.2s]" />
          <span className="size-1.5 rounded-full bg-muted-foreground/50 motion-safe:animate-[pulse_1s_cubic-bezier(0.16,1,0.3,1)_infinite] [animation-delay:-0.1s]" />
          <span className="size-1.5 rounded-full bg-muted-foreground/50 motion-safe:animate-[pulse_1s_cubic-bezier(0.16,1,0.3,1)_infinite]" />
          {elapsedSeconds !== undefined ? (
            <span className="ml-2 text-xs text-muted-foreground/70 tabular-nums">
              Working for {formatRunDuration(elapsedSeconds)}
            </span>
          ) : null}
        </div>
      </div>
    </output>
  );
}

function AssistantRunTimerRow({
  active,
  children,
  detailsCount,
  metadata,
  modelId,
  startedAt,
}: {
  active: boolean;
  children?: ReactNode;
  detailsCount?: number;
  metadata: unknown;
  modelId?: string;
  startedAt?: number;
}) {
  const elapsedSeconds = useElapsedSeconds(active ? startedAt : undefined);
  const clientStartedAtRef = useRef<number | undefined>(undefined);
  const clientDurationSecondsRef = useRef<number | undefined>(undefined);
  const wasActiveRef = useRef(false);

  if (active && startedAt !== undefined) {
    clientStartedAtRef.current = startedAt;
  }

  if (elapsedSeconds !== undefined) {
    clientDurationSecondsRef.current = elapsedSeconds;
  }

  if (!active && wasActiveRef.current && clientStartedAtRef.current !== undefined) {
    clientDurationSecondsRef.current = Math.max(0, Math.round((Date.now() - clientStartedAtRef.current) / 1000));
  }

  wasActiveRef.current = active;

  const persistedRun = readAssistantRunMetadata(metadata);
  const durationSeconds = active ? elapsedSeconds : persistedRun?.durationSeconds ?? clientDurationSecondsRef.current;
  const tokenUsage = getAssistantRunUsage(metadata);
  const tokenCount = tokenUsage ? contextTokensFromUsage(tokenUsage) : undefined;
  const runCost = getAssistantRunCost(metadata) ?? (tokenUsage ? calculateCodexUsageCost(modelId, tokenUsage) : null);
  const hasDetails = (detailsCount ?? 0) > 0;

  if (durationSeconds === undefined && !hasDetails) {
    return null;
  }

  const summary = (
    <>
      <span className="tabular-nums">
        {durationSeconds === undefined
          ? active ? "Working" : "Worked"
          : `${active ? "Working" : "Worked"} for ${formatRunDuration(durationSeconds)}`}
      </span>
      {tokenCount !== undefined ? (
        <>
          <span aria-hidden="true" className="h-3 w-px bg-border/70" />
          <span className="tabular-nums">{formatTokens(tokenCount)} tokens</span>
        </>
      ) : null}
      {runCost && runCost.total > 0 ? (
        <>
          <span aria-hidden="true" className="h-3 w-px bg-border/70" />
          <span className="tabular-nums">{formatRunCost(runCost.total)}</span>
        </>
      ) : null}
    </>
  );

  if (!hasDetails) {
    return (
      <div className="mb-2.5 flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-muted-foreground/75">
        {summary}
      </div>
    );
  }

  return (
    <Collapsible className="group mb-2.5 w-full" defaultOpen={false}>
      <CollapsibleTrigger className="flex w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-left text-xs font-medium text-muted-foreground/75 outline-none transition-colors hover:text-foreground/85 focus-visible:ring-1 focus-visible:ring-ring/40">
        <ChevronDown
          className="size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200 group-data-[state=open]:rotate-180"
          aria-hidden="true"
        />
        {summary}
        <span className="sr-only">Toggle run details</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden pt-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1">
        <div className="space-y-1.5 border-l border-border/25 pl-3">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SandboxStatusBar({
  sandboxStatus,
  runtimeStatus,
  checking = false,
}: {
  sandboxStatus?: "creating" | "ready" | "failed";
  runtimeStatus?: "started" | "stopped" | "archived" | "unknown";
  checking?: boolean;
}) {
  const vmLabel = sandboxStatus === "ready" ? runtimeStatus ?? "unknown" : sandboxStatus ?? "unknown";
  const barClass =
    sandboxStatus === "failed"
      ? "bg-destructive"
      : sandboxStatus === "creating" || checking
        ? "bg-[color:var(--cohere-coral)]"
        : runtimeStatus === "started"
          ? "bg-[color:var(--cohere-deep-green)]"
          : runtimeStatus === "stopped"
            ? "bg-muted-foreground"
            : runtimeStatus === "archived"
              ? "bg-[color:var(--cohere-action-blue)]"
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


type KeyedMessage = { message: UIMessage; messageKey: string };

export function ThreadMessages({
  keyedMessages,
  ready,
  error,
  showingInitialPromptHandoff,
  initialPrompt,
  awaitingAgentResponse,
  activeAssistantMessageId,
  activeRunStartedAt,
  modelId,
  recordingPlaybackBasePath,
  onSubmitMessage,
  diffEntries,
  workspaceChangedFiles,
  onSelectChangedFile,
}: {
  keyedMessages: KeyedMessage[];
  ready: boolean;
  error?: Error;
  showingInitialPromptHandoff: boolean;
  initialPrompt?: string;
  awaitingAgentResponse: boolean;
  activeAssistantMessageId?: string;
  activeRunStartedAt?: number;
  modelId?: string;
  recordingPlaybackBasePath?: string;
  onSubmitMessage: (text: string) => void;
  diffEntries: ThreadDiffEntry[];
  workspaceChangedFiles: GitChangedFile[];
  onSelectChangedFile: (file: ThreadChangedFile) => void;
}) {
  const userMessageNavigation: Array<{ id: string; preview: string }> = [];
  for (const { message } of keyedMessages) {
    if (message.role === "user") {
      const text = getTextParts(message.parts).replace(/\s+/g, " ").trim();
      userMessageNavigation.push({
        id: message.id,
        preview: text || "Message with an attachment",
      });
    }
  }

  const latestAssistantMessageId = [...keyedMessages]
    .reverse()
    .find(({ message }) => message.role === "assistant")?.message.id;

  return (
  <Conversation className="minimal-scrollbar h-full min-h-0">
    <ConversationContent className="pb-[10.5rem]">
    {keyedMessages.length === 0 && !showingInitialPromptHandoff ? (
      <ConversationEmptyState className="mx-auto max-w-[680px] items-start px-6 py-10 text-left sm:px-8" icon={<Bot className="size-6 text-muted-foreground" />}>
        <div className="max-w-xl">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Repository thread
          </p>
          <h2 className="mt-2 text-lg font-medium leading-snug text-foreground sm:text-xl">
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
              onClick={() => void onSubmitMessage(suggestion)}
              className="min-h-[72px] rounded-sm border border-border bg-[color:var(--project-panel-soft)] p-3.5 text-left text-sm leading-relaxed text-foreground transition hover:border-[color:var(--project-selected-strong)] hover:bg-[color:var(--project-selected)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--cohere-form-focus)] disabled:cursor-not-allowed disabled:opacity-40"
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
      const messageChangedFiles = !isUser && message.id !== activeAssistantMessageId
        ? changedFilesForMessage(diffEntries, message.id)
        : [];
      const changedFiles = mergeChangedFilesWithWorkspace(
        messageChangedFiles,
        !isUser && message.id === latestAssistantMessageId && message.id !== activeAssistantMessageId
          ? workspaceChangedFiles
          : [],
      );
      const messageText = isUser ? getTextParts(message.parts) : "";
      const isImageFileItem = (item: GroupedItem) =>
        item.kind === "single" && isFileUIPart(item.part) && item.part.mediaType.startsWith("image/");
      const isComputerRecordingItem = (item: GroupedItem) => {
        if (item.kind !== "single" || !isToolUIPart(item.part)) {
          return false;
        }

        const partState = getToolState(item.part);
        const input = "input" in item.part ? item.part.input : undefined;
        const output = "output" in item.part ? item.part.output : undefined;
        const toolName = item.part.type === "dynamic-tool" ? getToolName(item.part) : undefined;
        const toolSlug = toolSlugFromPart(item.part.type, toolName);

        return toolSlug === "computer" && isComputerRecordingTool(input, output, partState);
      };
      const imageFileItems = isUser ? grouped.filter(isImageFileItem) : [];
      const displayGrouped = isUser
        ? grouped.filter((item) => !isImageFileItem(item))
        : grouped;
      const recordingItems = !isUser ? displayGrouped.filter(isComputerRecordingItem) : [];
      const isVisibleRunDetailItem = (item: GroupedItem) => {
        if (isComputerRecordingItem(item)) {
          return false;
        }

        if (item.kind === "explore-group") {
          return true;
        }

        const { part } = item;
        if (isReasoningUIPart(part)) {
          return true;
        }
        if (!isToolUIPart(part)) {
          return false;
        }

        const partState = getToolState(part);
        const input = "input" in part ? part.input : undefined;
        const output = "output" in part ? part.output : undefined;
        const toolName = part.type === "dynamic-tool" ? getToolName(part) : undefined;
        const toolSlug = toolSlugFromPart(part.type, toolName);

        return toolSlug !== "computer" || isComputerRecordingTool(input, output, partState);
      };
      const runDetailItems = !isUser ? displayGrouped.filter(isVisibleRunDetailItem) : [];
      const mainDisplayGrouped =
        runDetailItems.length > 0 || recordingItems.length > 0
          ? displayGrouped.filter(
              (item) => !isVisibleRunDetailItem(item) && !isComputerRecordingItem(item)
            )
          : displayGrouped;
      const renderRecordingItem = (item: GroupedItem) => {
        if (item.kind !== "single" || !isToolUIPart(item.part)) {
          return null;
        }

        const output = "output" in item.part ? item.part.output : undefined;

        return (
          <ToolRecordingOutput
            key={`${message.id}-recording-${item.stableKey}`}
            className="mb-2"
            output={output}
            recordingPlaybackBasePath={recordingPlaybackBasePath}
          />
        );
      };
      const renderGroupedItem = (item: GroupedItem, location: "main" | "run-details") => {
        const keyScope = `${message.id}-${location}`;

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
              key={`${keyScope}-explore-${tools[0].stableKey}`}
              messageId={message.id}
              tools={tools}
              summaryParts={summaryParts}
              anyStreaming={anyStreaming}
              defaultOpen={location === "run-details"}
            />
          );
        }

        const { part, stableKey } = item;

        if (isReasoningUIPart(part)) {
          const partState = getPartState(part);
          return (
            <Reasoning
              key={`${keyScope}-reasoning-${stableKey}`}
              defaultOpen={location === "run-details" ? true : undefined}
              isStreaming={partState === "streaming"}
            >
              <ReasoningTrigger />
              <ReasoningContent>{part.text}</ReasoningContent>
            </Reasoning>
          );
        }

        if (isTextUIPart(part)) {
          const partState = getPartState(part);
          return (
            <MessageResponse key={`${keyScope}-text-${stableKey}`} isAnimating={partState === "streaming"}>
              {part.text}
            </MessageResponse>
          );
        }

        if (isFileUIPart(part)) {
          if (part.mediaType.startsWith("image/")) {
            return (
              <ImageAttachmentPreview
                key={`${keyScope}-file-${stableKey}`}
                alt={part.filename ?? "Attached image"}
                className="ml-auto mt-3 h-20 w-28 sm:h-24 sm:w-36"
                src={part.url}
              />
            );
          }

          return (
            <a
              key={`${keyScope}-file-${stableKey}`}
              className="w-fit max-w-full truncate border border-border bg-muted px-2.5 py-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
              href={part.url}
              rel="noreferrer"
              target="_blank"
            >
              {part.filename ?? part.mediaType}
            </a>
          );
        }

        if (isToolUIPart(part)) {
          const partState = getToolState(part);
          const input = "input" in part ? part.input : undefined;
          const output = "output" in part ? part.output : undefined;
          const errorText = "errorText" in part ? part.errorText : undefined;
          const toolName = part.type === "dynamic-tool" ? getToolName(part) : undefined;
          const toolSlug = toolSlugFromPart(part.type, toolName);

          if (
            toolSlug === "computer" &&
            !isComputerRecordingTool(input, output, partState)
          ) {
            return null;
          }
          const defaultToolOpen = partState !== "output-available";

          return (
            <Tool
              key={`${keyScope}-tool-${stableKey}`}
              className={cn(
                (toolSlug === "bash" || toolSlug === "edit" || toolSlug === "write") &&
                  "my-1.5 overflow-hidden rounded-lg border border-border/70 bg-card text-muted-foreground shadow-none",
              )}
              data-tool={toolSlug}
              defaultOpen={defaultToolOpen}
            >
              {part.type === "dynamic-tool" ? (
                <ToolHeader
                  input={input}
                  output={output}
                  state={partState}
                  toolName={toolName!}
                  type={part.type}
                />
              ) : (
                <ToolHeader input={input} output={output} state={partState} type={part.type} />
              )}
              <ToolContent>
                {input !== undefined ? (
                  <ToolInput
                    input={input}
                    state={partState}
                    toolName={part.type === "dynamic-tool" ? getToolName(part) : undefined}
                    toolType={part.type}
                  />
                ) : null}
                <ToolOutput
                  errorText={errorText}
                  output={output}
                  recordingPlaybackBasePath={recordingPlaybackBasePath}
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
            key={`${keyScope}-part-${stableKey}`}
            className="rounded-md border border-dashed border-border/50 px-3 py-2 font-mono text-xs text-muted-foreground"
          >
            {part.type}
          </div>
        );
      };
  
      return (
        <ConversationMessage
          key={messageKey}
          messageId={message.id}
          scrollAnchor={isUser}
        >
          <MessageGroup className="gap-0">
            <Message
              from={message.role}
              className={cn(
                "mx-auto w-full min-w-0 max-w-[680px] px-6 py-3 sm:px-8",
                isUser ? "py-2.5" : "py-3.5",
              )}
            >
              <MessageContent
                className={cn(
                  "gap-1.5 overflow-visible",
                  isUser && "group/user-message relative",
                )}
              >
                {imageFileItems.length > 0 ? (
                  <div className="flex max-w-full flex-row-reverse flex-wrap gap-2">
                    {imageFileItems.map((item) => {
                      if (item.kind !== "single" || !isFileUIPart(item.part)) {
                        return null;
                      }

                      return (
                        <ImageAttachmentPreview
                          key={`${message.id}-floating-file-${item.stableKey}`}
                          alt={item.part.filename ?? "Attached image"}
                          className="h-20 w-28 sm:h-24 sm:w-36"
                          src={item.part.url}
                        />
                      );
                    })}
                  </div>
                ) : null}
                {!isUser || mainDisplayGrouped.length > 0 ? (
                  <div
                    className={cn(
                      "min-w-0 max-w-full",
                      isUser
                        ? "rounded-[var(--radius-xxl)] border border-border/45 bg-muted/45 px-3.5 py-2.5 text-[14px] leading-[1.65] text-foreground [overflow-wrap:anywhere] dark:bg-muted/30"
                        : "w-full",
                    )}
                  >
                    {!isUser ? (
                      <MessageHeader className="block max-w-none p-0 text-inherit">
                        <AssistantRunTimerRow
                          active={message.id === activeAssistantMessageId}
                          detailsCount={runDetailItems.length}
                          metadata={message.metadata}
                          modelId={modelId}
                          startedAt={activeRunStartedAt}
                        >
                          {runDetailItems.map((item) => renderGroupedItem(item, "run-details"))}
                        </AssistantRunTimerRow>
                      </MessageHeader>
                    ) : null}
                    {!isUser ? recordingItems.map(renderRecordingItem) : null}
                    {mainDisplayGrouped.map((item) => renderGroupedItem(item, "main"))}
                    {!isUser ? (
                      <ThreadChangedFiles files={changedFiles} onSelect={onSelectChangedFile} />
                    ) : null}
                  </div>
                ) : null}
                {isUser ? <UserMessageCopyButton text={messageText} /> : null}
              </MessageContent>
            </Message>
          </MessageGroup>
        </ConversationMessage>
      );
    })}
  
    {error ? (
      <div className="w-full min-w-0 max-w-full" role="alert">
        <div className="mx-auto w-full min-w-0 max-w-[680px] px-6 py-3 sm:px-8">
          <div className="rounded-[var(--radius-lg)] border border-destructive/25 bg-destructive/5 px-3.5 py-2.5">
            <p className="break-words text-[13px] text-destructive [overflow-wrap:anywhere]">{error.message}</p>
          </div>
        </div>
      </div>
    ) : null}
  
    {showingInitialPromptHandoff ? <ThreadHandoffPreview prompt={initialPrompt!} /> : null}
    {awaitingAgentResponse ? <AwaitingAgentIndicator startedAt={activeRunStartedAt} /> : null}
    <div className="h-8 shrink-0" />
    </ConversationContent>
    <ConversationMessageNavigation messages={userMessageNavigation} />
    <ConversationScrollButton className="bottom-[11.5rem]" />
  </Conversation>
  );
}
