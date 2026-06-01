import { cn } from "@autopr/ui/lib/utils";
import { getToolName, isReasoningUIPart, isTextUIPart, isToolUIPart, type UIMessage } from "ai";
import { Bot, ChevronDown } from "lucide-react";
import { useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  ExploreToolRow,
  isExploreTool,
  isComputerRecordingTool,
  toolSlugFromPart,
  type ToolPart,
} from "@/components/ai-elements/tool";

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

export function SandboxStatusBar({
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


type KeyedMessage = { message: UIMessage; messageKey: string };

export function ThreadMessages({
  keyedMessages,
  ready,
  error,
  showingInitialPromptHandoff,
  initialPrompt,
  awaitingAgentResponse,
  onSubmitMessage,
}: {
  keyedMessages: KeyedMessage[];
  ready: boolean;
  error?: Error;
  showingInitialPromptHandoff: boolean;
  initialPrompt?: string;
  awaitingAgentResponse: boolean;
  onSubmitMessage: (text: string) => void;
}) {
  return (
  <Conversation className="minimal-scrollbar h-full min-h-0">
    <ConversationContent>
    {keyedMessages.length === 0 && !showingInitialPromptHandoff ? (
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
              onClick={() => void onSubmitMessage(suggestion)}
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
                  const toolName = part.type === "dynamic-tool" ? getToolName(part) : undefined;

                  if (
                    toolSlugFromPart(part.type, toolName) === "computer" &&
                    !isComputerRecordingTool(input, output, partState)
                  ) {
                    return null;
                  }
  
                  return (
                    <Tool key={`${message.id}-tool-${stableKey}`} defaultOpen={partState !== "output-available"}>
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
  );
}
