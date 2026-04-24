"use client";

import { useChat } from "@ai-sdk/react";
import { api } from "@autopr/backend/convex/_generated/api";
import { TooltipProvider } from "@autopr/ui/components/tooltip";
import { UserButton } from "@clerk/nextjs";
import { WorkflowChatTransport } from "@workflow/ai";
import { useConvexAuth, useQuery } from "convex/react";
import {
  getToolName,
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
  type PrepareReconnectToStreamRequest,
  type UIMessage,
} from "ai";
import {
  ArrowLeft,
  Bot,
  FlaskConical,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";

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
import { toUIMessage } from "@/lib/chat-messages";
import { ModeToggle } from "@/components/mode-toggle";
import { AuthGate, ProjectShell } from "@/components/project-shell";

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
  const resumedRunIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (currentRunId) {
      activeRunIdRef.current = currentRunId;
    }
  }, [currentRunId]);

  const agentApi = useMemo(
    () => `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}/agent`,
    [projectId, threadId],
  );

  const getRunStreamApi = useCallback(
    (runId: string) => `${agentApi}/${encodeURIComponent(runId)}/stream`,
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
  });

  useEffect(() => {
    if (!currentRunId || status !== "ready" || resumedRunIdsRef.current.has(currentRunId)) {
      return;
    }

    resumedRunIdsRef.current.add(currentRunId);
    void resumeStream();
  }, [currentRunId, resumeStream, status]);

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
              <ConversationEmptyState className="items-start border border-primary/15 bg-background p-5 text-left shadow-[inset_0_1px_0_0_rgba(var(--primary),0.05)] sm:p-6" icon={<Bot className="size-8 text-primary" />}>
                <div className="max-w-xl">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Repository thread
                  </p>
                  <h2 className="mt-3 text-xl font-extrabold uppercase leading-snug tracking-[0.03em] sm:text-2xl">
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
                      className="min-h-20 border border-primary/15 bg-primary/4 p-3 text-left text-sm leading-relaxed text-foreground/90 transition hover:border-primary/40 hover:bg-primary/7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-primary/6"
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
          className="border border-primary/25 bg-background shadow-[0_18px_70px_rgba(0,0,0,0.16),inset_0_1px_0_0_rgba(var(--primary),0.07)]"
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
                <FlaskConical className="size-3 text-primary" aria-hidden="true" />
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
  const projectId = params.projectId;
  const threadId = params.threadId;
  const project = useQuery(api.projects.get, isAuthenticated ? { projectId } : "skip");
  const thread = useQuery(api.threads.get, isAuthenticated ? { threadId } : "skip");
  const threads = useQuery(api.threads.listByProject, isAuthenticated ? { projectId } : "skip");
  const dbMessages = useQuery(api.messages.listByThread, isAuthenticated ? { threadId } : "skip");

  const initialMessages = useMemo(() => dbMessages?.map(toUIMessage) ?? [], [dbMessages]);
  const loading = project === undefined || thread === undefined || dbMessages === undefined;
  const notFound = !loading && (!project || !thread || thread.projectId !== projectId);
  const disabled = !project || project.sandboxStatus !== "ready";

  return (
    <AuthGate>
      <TooltipProvider>
        <ProjectShell
          projectId={projectId}
          repoFullName={project?.repoFullName}
          threads={threads}
          activeThreadId={threadId}
        >
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
                <div className="inline-flex h-9 items-center gap-2 border border-primary/20 bg-primary/6 px-3 font-mono text-[11px] text-muted-foreground dark:bg-primary/8">
                  <span
                    className={`size-2 shrink-0 border border-foreground/80 ${
                      thread?.isLive ? "bg-primary shadow-[0_0_0_3px_rgba(var(--primary),0.25)]" : "bg-background"
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
        </ProjectShell>
      </TooltipProvider>
    </AuthGate>
  );
}
