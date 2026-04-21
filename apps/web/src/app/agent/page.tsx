"use client";

import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@workflow/ai";
import { getToolName, isReasoningUIPart, isTextUIPart, isToolUIPart } from "ai";
import { Bot, FlaskConical, Trash2 } from "lucide-react";
import Link from "next/link";
import { Syne } from "next/font/google";
import { useMemo, useSyncExternalStore } from "react";

import { ModeToggle } from "@/components/mode-toggle";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput, type ToolPart } from "@/components/ai-elements/tool";
import { TooltipProvider } from "@autopr/ui/components/tooltip";

const display = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
});

const ACTIVE_RUN_ID_KEY = "autopr-agent-active-workflow-run-id";
const ACTIVE_RUN_ID_EVENT = "autopr-agent-active-workflow-run-id-change";

function subscribeToActiveRunId(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(ACTIVE_RUN_ID_EVENT, callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(ACTIVE_RUN_ID_EVENT, callback);
  };
}

function getActiveRunIdSnapshot() {
  return localStorage.getItem(ACTIVE_RUN_ID_KEY) ?? undefined;
}

function getActiveRunIdServerSnapshot() {
  return undefined;
}

function setStoredActiveRunId(runId?: string) {
  if (runId) {
    localStorage.setItem(ACTIVE_RUN_ID_KEY, runId);
  } else {
    localStorage.removeItem(ACTIVE_RUN_ID_KEY);
  }

  window.dispatchEvent(new Event(ACTIVE_RUN_ID_EVENT));
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

export default function AgentPage() {
  const activeRunId = useSyncExternalStore(
    subscribeToActiveRunId,
    getActiveRunIdSnapshot,
    getActiveRunIdServerSnapshot,
  );

  const transport = useMemo(
    () =>
      new WorkflowChatTransport({
        api: "/api/agent",
        onChatSendMessage: (response) => {
          const workflowRunId = response.headers.get("x-workflow-run-id");
          if (workflowRunId) {
            setStoredActiveRunId(workflowRunId);
          }
        },
        onChatEnd: () => {
          setStoredActiveRunId(undefined);
        },
        prepareReconnectToStreamRequest: (options) => {
          const runId = localStorage.getItem(ACTIVE_RUN_ID_KEY);
          if (!runId) {
            throw new Error("No active workflow run ID found");
          }

          return {
            ...options,
            api: `/api/agent/${encodeURIComponent(runId)}/stream`,
          };
        },
      }),
    [],
  );

  const { messages, sendMessage, status, stop, error, clearError, setMessages } = useChat({
    resume: Boolean(activeRunId),
    transport,
  });

  const busy = status === "submitted" || status === "streaming";
  const ready = status === "ready";

  async function submitMessage(text: string) {
    const nextMessage = text.trim();
    if (!nextMessage || !ready) {
      return;
    }

    clearError();
    await sendMessage({ text: nextMessage });
  }

  function resetChat() {
    clearError();
    setStoredActiveRunId(undefined);
    setMessages([]);
  }

  return (
    <TooltipProvider>
      <div className="relative flex min-h-svh flex-1 flex-col overflow-x-clip text-foreground">
        <div className="border-b border-teal-500/15 bg-teal-500/[0.07] px-4 py-2 text-center text-[11px] font-medium tracking-wide text-teal-900/90 dark:text-teal-100/90">
          Sandbox billing only · Bring your Codex subscription — zero API markup from us
        </div>

        <main className="relative mx-auto flex w-full max-w-5xl min-h-0 flex-1 flex-col px-5 pb-10 pt-10 sm:px-8 sm:pb-12 sm:pt-14 lg:px-12">
          <header className="relative z-10 mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border/50 pb-8">
            <div className="max-w-2xl">
              <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground sm:text-sm">
                Durable workflow stream · creates a Daytona sandbox per run and exposes file, search, edit, and bash
                tools inside it.
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Daytona agent
              </p>
              <h1
                className={`${display.className} mt-2 text-balance text-[clamp(1.35rem,3.5vw,1.85rem)] font-extrabold uppercase leading-[1.08] tracking-[0.04em]`}
              >
                Sandbox workbench
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex h-9 items-center gap-2 border border-teal-500/20 bg-teal-500/6 px-3 font-mono text-[11px] text-muted-foreground dark:bg-teal-500/8">
                <span
                  className={`size-2 shrink-0 border border-foreground/80 ${
                    busy ? "bg-teal-500 shadow-[0_0_0_3px_rgba(45,212,191,0.25)]" : ready ? "bg-background" : "bg-amber-400"
                  }`}
                />
                {busy ? "Streaming" : ready ? "Ready" : status}
              </div>
              <button
                type="button"
                onClick={resetChat}
                className="inline-flex size-9 items-center justify-center border border-border bg-background text-muted-foreground transition hover:border-teal-500/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label="Reset chat"
                title="Reset chat"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </div>
          </header>

          <section className="grid min-h-0 w-full flex-1 grid-rows-[1fr_auto]">
            <div className="relative min-h-0 overflow-hidden border border-teal-500/15 bg-background shadow-[inset_0_1px_0_0_rgba(45,212,191,0.05)]">
              <Conversation className="h-full">
                <ConversationContent className="min-h-full gap-5 p-4 sm:p-6">
                {messages.length === 0 ? (
                  <ConversationEmptyState className="items-start text-left" icon={<Bot className="size-8 text-teal-600 dark:text-teal-400" />}>
                    <div className="max-w-xl">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                        Agent bench
                      </p>
                      <h2
                        className={`${display.className} mt-3 text-xl font-extrabold uppercase leading-snug tracking-[0.03em] sm:text-2xl`}
                      >
                        Send a prompt and let the agent inspect and modify its Daytona sandbox.
                      </h2>
                    </div>
                    <div className="grid w-full gap-2 sm:grid-cols-3">
                      {[
                        "List the sandbox workdir and summarize what is available.",
                        "Create hello.txt, read it back, then explain what changed.",
                        "Run node --version and tell me what runtime is available.",
                      ].map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          disabled={!ready}
                          onClick={() => void submitMessage(suggestion)}
                          className="min-h-20 border border-teal-500/15 bg-teal-500/4 p-3 text-left text-sm leading-relaxed text-foreground/90 transition hover:border-teal-500/40 hover:bg-teal-500/7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40 dark:bg-teal-500/6"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </ConversationEmptyState>
                ) : null}

                {messages.map((message) => (
                  <Message key={message.id} from={message.role}>
                    <MessageContent
                      className={
                        message.role === "user"
                          ? "rounded-none border border-foreground bg-muted/35"
                          : "w-full max-w-full"
                      }
                    >
                      {message.parts.filter(Boolean).map((part, index) => {
                        if (isReasoningUIPart(part)) {
                          const partState = getPartState(part);

                          return (
                            <Reasoning
                              key={`${message.id}-reasoning-${index}`}
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
                            <MessageResponse
                              key={`${message.id}-text-${index}`}
                              isAnimating={partState === "streaming"}
                            >
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
                                <ToolHeader state={partState} toolName={getToolName(part)} type={part.type} />
                              ) : (
                                <ToolHeader state={partState} type={part.type} />
                              )}
                              <ToolContent>
                                {input !== undefined ? <ToolInput input={input} /> : null}
                                <ToolOutput errorText={errorText} output={output} />
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
                            className="border border-dashed border-border px-3 py-2 font-mono text-xs text-muted-foreground"
                          >
                            {part.type}
                          </div>
                        );
                      })}
                    </MessageContent>
                  </Message>
                ))}

                {error ? (
                  <div
                    role="alert"
                    className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm shadow-[inset_0_1px_0_0_rgba(248,113,113,0.12)]"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-destructive">Error</p>
                    <p className="mt-1 text-destructive">{error.message}</p>
                  </div>
                ) : null}
              </ConversationContent>
              <ConversationScrollButton className="bottom-4" />
            </Conversation>
          </div>

          <div className="border-x border-b border-teal-500/15 bg-background p-3 sm:p-4">
            {activeRunId ? (
              <p className="mb-2 truncate font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Run {activeRunId}
              </p>
            ) : null}
            <PromptInput
              onSubmit={(message) => {
                void submitMessage(message.text);
              }}
            >
              <PromptInputBody>
                <PromptInputTextarea disabled={!ready} placeholder="Ask the sandbox agent to inspect, run, or edit..." />
              </PromptInputBody>
              <PromptInputFooter>
                <PromptInputTools>
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    <FlaskConical className="size-3 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                    Daytona tools
                  </span>
                </PromptInputTools>
                <PromptInputSubmit disabled={!ready && !busy} onStop={() => void stop()} status={status} />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </section>

          <footer className="relative z-10 mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-border/50 pt-10 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <span>© {new Date().getFullYear()} autopr</span>
            <div className="flex flex-wrap items-center gap-6">
              <Link
                href="/"
                className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Home
              </Link>
              <Link
                href="/dashboard"
                className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Dashboard
              </Link>
              <ModeToggle />
            </div>
          </footer>
        </main>
      </div>
    </TooltipProvider>
  );
}
