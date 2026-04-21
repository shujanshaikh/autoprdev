"use client";

import { useChat } from "@ai-sdk/react";
import { api } from "@autopr/backend/convex/_generated/api";
import type { Id } from "@autopr/backend/convex/_generated/dataModel";
import { TooltipProvider } from "@autopr/ui/components/tooltip";
import { UserButton } from "@clerk/nextjs";
import { WorkflowChatTransport } from "@workflow/ai";
import { Authenticated, AuthLoading, Unauthenticated, useConvexAuth, useQuery } from "convex/react";
import { getToolName, isReasoningUIPart, isTextUIPart, isToolUIPart, type UIMessage } from "ai";
import {
  ArrowLeft,
  Bot,
  FlaskConical,
  Home,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  Search,
} from "lucide-react";
import Link from "next/link";
import { Syne } from "next/font/google";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

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
import { ModeToggle } from "@/components/mode-toggle";

const display = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
});

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

function toUIMessage(row: {
  messageId: string;
  role: "system" | "user" | "assistant";
  parts: UIMessage["parts"];
  metadata?: unknown;
}): UIMessage {
  return {
    id: row.messageId,
    role: row.role,
    parts: row.parts,
    metadata: row.metadata,
  };
}

function ThreadChat({
  projectId,
  threadId,
  currentRunId,
  initialMessages,
  disabled,
}: {
  projectId: string;
  threadId: string;
  currentRunId?: string;
  initialMessages: UIMessage[];
  disabled: boolean;
}) {
  const activeRunIdRef = useRef(currentRunId);

  useEffect(() => {
    activeRunIdRef.current = currentRunId;
  }, [currentRunId]);

  const transport = useMemo(
    () =>
      new WorkflowChatTransport<UIMessage>({
        api: `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}/agent`,
        onChatSendMessage: (response) => {
          const workflowRunId = response.headers.get("x-workflow-run-id");
          if (workflowRunId) {
            activeRunIdRef.current = workflowRunId;
          }
        },
        onChatEnd: () => {
          activeRunIdRef.current = undefined;
        },
        prepareSendMessagesRequest: (options) => ({
          api: options.api,
          body: {
            message: options.messages[options.messages.length - 1],
          },
          headers: options.headers,
          credentials: options.credentials,
        }),
        prepareReconnectToStreamRequest: (options) => {
          const runId = activeRunIdRef.current;

          if (!runId) {
            throw new Error("No active workflow run ID found");
          }

          return {
            ...options,
            api: `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}/agent/${encodeURIComponent(runId)}/stream`,
          };
        },
      }),
    [projectId, threadId],
  );

  const { messages, sendMessage, status, stop, error, clearError } = useChat<UIMessage>({
    id: threadId,
    messages: initialMessages,
    resume: Boolean(currentRunId),
    transport,
  });

  const busy = status === "submitted" || status === "streaming";
  const ready = status === "ready" && !disabled;

  async function submitMessage(text: string) {
    const nextMessage = text.trim();
    if (!nextMessage || !ready) {
      return;
    }

    clearError();
    await sendMessage({ text: nextMessage });
  }

  return (
    <section className="grid min-h-0 w-full min-w-0 flex-1 grid-rows-[1fr_auto]">
      <div className="relative min-h-0 min-w-0 overflow-hidden">
        <Conversation className="minimal-scrollbar h-full min-h-0">
          <ConversationContent className="mx-auto min-h-full w-full max-w-[780px] gap-5 px-4 py-6 sm:px-6 sm:py-8 lg:px-0">
            {messages.length === 0 ? (
              <ConversationEmptyState className="items-start border border-teal-500/15 bg-background p-5 text-left shadow-[inset_0_1px_0_0_rgba(45,212,191,0.05)] sm:p-6" icon={<Bot className="size-8 text-teal-600 dark:text-teal-400" />}>
                <div className="max-w-xl">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Repository thread
                  </p>
                  <h2 className={`${display.className} mt-3 text-xl font-extrabold uppercase leading-snug tracking-[0.03em] sm:text-2xl`}>
                    Ask the agent to inspect, run, edit, or explain this repository.
                  </h2>
                </div>
                <div className="grid w-full gap-2 sm:grid-cols-3">
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
                      className="min-h-20 border border-teal-500/15 bg-teal-500/4 p-3 text-left text-sm leading-relaxed text-foreground/90 transition hover:border-teal-500/40 hover:bg-teal-500/7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-teal-500/6"
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
                  className={message.role === "user" ? "rounded-none border border-foreground bg-muted/35" : "w-full max-w-full"}
                >
                  {message.parts.filter(Boolean).map((part, index) => {
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
              <div role="alert" className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-destructive">Error</p>
                <p className="mt-1 text-destructive">{error.message}</p>
              </div>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton className="bottom-4" />
        </Conversation>
      </div>

      <div className="mx-auto w-full max-w-[780px] shrink-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pb-[max(1rem,env(safe-area-inset-bottom))] lg:px-0">
        {currentRunId ? (
          <p className="mb-2 truncate font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Run {currentRunId}
          </p>
        ) : null}
        <PromptInput
          className="border border-teal-500/25 bg-background shadow-[0_18px_70px_rgba(0,0,0,0.16),inset_0_1px_0_0_rgba(45,212,191,0.07)]"
          onSubmit={(message) => {
            void submitMessage(message.text);
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea disabled={!ready} placeholder="Ask the repo agent to inspect, run, or edit..." />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <FlaskConical className="size-3 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                Shared project sandbox
              </span>
            </PromptInputTools>
            <PromptInputSubmit disabled={!ready && !busy} onStop={() => void stop()} status={status} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </section>
  );
}

export default function ProjectThreadPage() {
  const params = useParams<{ projectId: string; threadId: string }>();
  const { isAuthenticated } = useConvexAuth();
  const projectId = params.projectId as Id<"projects">;
  const threadId = params.threadId as Id<"threads">;
  const project = useQuery(api.projects.get, isAuthenticated ? { projectId } : "skip");
  const thread = useQuery(api.threads.get, isAuthenticated ? { threadId } : "skip");
  const threads = useQuery(api.threads.listByProject, isAuthenticated ? { projectId } : "skip");
  const dbMessages = useQuery(api.messages.listByThread, isAuthenticated ? { threadId } : "skip");

  const initialMessages = useMemo(() => dbMessages?.map(toUIMessage) ?? [], [dbMessages]);
  const loading = project === undefined || thread === undefined || dbMessages === undefined;
  const notFound = !loading && (!project || !thread || thread.projectId !== projectId);
  const disabled = !project || project.sandboxStatus !== "ready";

  return (
    <>
      <Authenticated>
        <TooltipProvider>
          <div className="relative flex h-dvh max-h-dvh overflow-hidden bg-background text-foreground">
            <aside className="hidden w-[250px] shrink-0 border-r border-border/70 bg-muted/20 lg:flex lg:flex-col">
              <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-3">
                <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
                  <div className="grid size-6 shrink-0 place-items-center border border-teal-500/25 bg-teal-500/10 text-[10px] font-black text-teal-700 dark:text-teal-300">
                    A
                  </div>
                  <span className="truncate font-mono text-xs font-semibold text-foreground/90">
                    {project?.repoFullName ?? "autopr"}
                  </span>
                </Link>
                <MoreHorizontal className="ml-auto size-4 text-muted-foreground" aria-hidden="true" />
              </div>

              <div className="p-3">
                <label className="flex h-9 items-center gap-2 border border-border bg-background/70 px-2 text-xs text-muted-foreground">
                  <Search className="size-3.5" aria-hidden="true" />
                  <span>Search</span>
                  <span className="ml-auto font-mono text-[10px]">Cmd K</span>
                </label>
              </div>

              <nav className="grid gap-1 px-2 text-sm">
                <Link
                  href="/dashboard"
                  className="flex h-9 items-center gap-2 px-2 text-muted-foreground transition hover:bg-muted/45 hover:text-foreground"
                >
                  <Home className="size-4" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">Dashboard</span>
                </Link>
                <Link
                  href={`/project/${projectId}`}
                  className="flex h-9 items-center gap-2 px-2 text-muted-foreground transition hover:bg-muted/45 hover:text-foreground"
                >
                  <MessageSquare className="size-4" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">Threads</span>
                  {typeof threads?.length === "number" ? <span className="font-mono text-xs">{threads.length}</span> : null}
                </Link>
              </nav>

              <div className="mt-6 min-h-0 flex-1 overflow-hidden px-2">
                <div className="mb-2 flex items-center justify-between px-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Recents
                  </p>
                  <PanelLeft className="size-3.5 text-muted-foreground" aria-hidden="true" />
                </div>

                <div className="grid gap-1 overflow-y-auto pr-1">
                  {threads === undefined ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground">Loading threads</div>
                  ) : threads.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground">No threads yet.</div>
                  ) : (
                    threads.slice(0, 8).map((recentThread) => (
                      <Link
                        key={recentThread._id}
                        href={`/project/${projectId}/thread/${recentThread._id}`}
                        className={`group border px-2 py-2 transition ${
                          recentThread._id === threadId
                            ? "border-teal-500/20 bg-teal-500/8 text-foreground"
                            : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/35 hover:text-foreground"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                            {recentThread.title}
                          </span>
                          {recentThread.isLive ? (
                            <span className="size-1.5 shrink-0 bg-teal-500 shadow-[0_0_0_3px_rgba(45,212,191,0.18)]" />
                          ) : null}
                        </div>
                        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                          {new Date(recentThread.updatedAt).toLocaleDateString()}
                        </p>
                      </Link>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-auto flex shrink-0 items-center justify-between border-t border-border/70 p-3">
                <Link href={`/project/${projectId}`} className="inline-flex items-center gap-2 text-xs text-muted-foreground transition hover:text-foreground">
                  <ArrowLeft className="size-3.5" aria-hidden="true" />
                  Project
                </Link>
                <UserButton />
              </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <header className="relative z-10 flex h-12 shrink-0 items-center border-b border-border/70 bg-background/95 px-3 backdrop-blur sm:px-4">
                <Link
                  href={`/project/${projectId}`}
                  className="mr-3 inline-flex items-center gap-2 text-xs text-muted-foreground transition hover:text-foreground lg:hidden"
                >
                  <ArrowLeft className="size-3.5" aria-hidden="true" />
                  Project
                </Link>

                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="hidden max-w-[220px] truncate font-mono text-xs text-muted-foreground sm:inline">
                    {project?.repoFullName ?? "Repository"}
                  </span>
                  <span className="hidden text-muted-foreground sm:inline">/</span>
                  <h1 className="min-w-0 truncate text-sm font-semibold">
                    {thread?.title ?? "Loading thread"}
                  </h1>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex h-9 items-center gap-2 border border-teal-500/20 bg-teal-500/6 px-3 font-mono text-[11px] text-muted-foreground dark:bg-teal-500/8">
                    <span
                      className={`size-2 shrink-0 border border-foreground/80 ${
                        thread?.isLive ? "bg-teal-500 shadow-[0_0_0_3px_rgba(45,212,191,0.25)]" : "bg-background"
                      }`}
                    />
                    {thread?.isLive ? "Streaming" : project?.sandboxStatus ?? "Loading"}
                  </div>
                  <ModeToggle />
                  <div className="lg:hidden">
                    <UserButton />
                  </div>
                </div>
              </header>

              <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                {loading ? (
                  <div className="grid min-h-80 flex-1 place-items-center border border-border text-sm text-muted-foreground">
                    <Loader2 className="mb-2 size-5 animate-spin" aria-hidden="true" />
                    Loading thread
                  </div>
                ) : notFound ? (
                  <div className="border border-border p-5 text-sm text-muted-foreground">Thread not found.</div>
                ) : (
                  <ThreadChat
                    key={threadId}
                    projectId={projectId}
                    threadId={threadId}
                    currentRunId={thread?.currentRunId}
                    initialMessages={initialMessages}
                    disabled={disabled}
                  />
                )}
              </main>
            </div>
          </div>
        </TooltipProvider>
      </Authenticated>

      <Unauthenticated>
        <main className="grid min-h-svh place-items-center px-5">
          <Link href="/dashboard" className="border border-border px-4 py-2 text-sm">
            Sign in from dashboard
          </Link>
        </main>
      </Unauthenticated>

      <AuthLoading>
        <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">
          <Loader2 className="mb-2 size-5 animate-spin" aria-hidden="true" />
          Loading
        </div>
      </AuthLoading>
    </>
  );
}
