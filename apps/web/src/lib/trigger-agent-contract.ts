import type { ModelMessage } from "ai";
import type { SandboxProvider } from "@autopr/backend/convex/lib/sandboxProvider";

export const AGENT_TASK_ID = "autopr-agent";
export const AGENT_CHAT_TASK_ID = "autopr-chat-agent";
export const AGENT_CHAT_OPERATION_HEADER = "x-autopr-agent-chat-operation";
export const AGENT_STREAM_ID = "assistant-ui";
// Trigger runs can execute for one hour; keep duplicate start requests bound
// to the original run for long enough to cover that entire lifecycle.
export const AGENT_IDEMPOTENCY_KEY_TTL = "2h";

export function agentProjectTag(projectId: string) {
  return `project:${projectId}`;
}

export function agentThreadTag(threadId: string) {
  return `thread:${threadId}`;
}

export function agentUserTag(userId: string) {
  return `user:${userId}`;
}

export function threadSandboxCacheKey(projectCacheKey: string, threadId: string) {
  return `${projectCacheKey}:thread:${threadId}`;
}

type AgentTaskId = typeof AGENT_TASK_ID | typeof AGENT_CHAT_TASK_ID;

export interface CodexAgentModelOptions<TTaskId extends AgentTaskId = AgentTaskId> {
  provider: "openai-codex";
  modelId: string;
  reasoningEffort: string;
  promptCacheKey?: string;
  /**
   * Opaque reference to the ChatGPT session credentials stored in WorkOS
   * Vault. The cookie itself must never appear on a Trigger.dev payload
   * because Trigger retains run payloads and session metadata; the worker
   * redeems this short-lived grant inside the run instead.
   */
  credentialsGrantId: string;
  credentialsGrantContext: {
    userId: string;
    taskId: TTaskId;
    contextId: string;
  };
}

export interface GrokAgentModelOptions<TTaskId extends AgentTaskId = AgentTaskId> {
  provider: "xai";
  modelId: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  promptCacheKey?: string;
  credentialsGrantId: string;
  credentialsGrantContext: {
    userId: string;
    taskId: TTaskId;
    contextId: string;
  };
}

export type AgentModelOptions<TTaskId extends AgentTaskId = AgentTaskId> =
  | CodexAgentModelOptions<TTaskId>
  | GrokAgentModelOptions<TTaskId>;

export interface AgentTaskOptions {
  projectId?: string;
  threadId?: string;
  sandboxCacheKey: string;
  sandboxId?: string;
  sandboxProvider?: SandboxProvider;
  sandboxWorkDir?: string;
  repoUrl?: string;
  repoBranch?: string;
  repoName?: string;
  assistantMessageId?: string;
  persistenceToken?: string;
  demoEnabled?: boolean;
  model: AgentModelOptions<typeof AGENT_TASK_ID>;
}

export interface AgentTaskPayload {
  messages: ModelMessage[];
  options: AgentTaskOptions;
}

/**
 * Browser-controlled preferences. The server validates these and replaces the
 * chat wire metadata with AgentChatClientData before it reaches Trigger.dev.
 */
export interface AgentChatClientInput extends Record<string, unknown> {
  provider?: "openai-codex" | "xai";
  model?: string;
  reasoningEffort?: string;
}

/**
 * Server-trusted, per-turn context consumed by the durable chat agent.
 * Secrets in this shape must only be populated by the authenticated input
 * proxy; browser clientData is intentionally never trusted as this type.
 */
export interface AgentChatClientData extends Record<string, unknown> {
  projectId: string;
  threadId: string;
  sandboxCacheKey: string;
  sandboxId?: string;
  sandboxProvider: SandboxProvider;
  sandboxWorkDir?: string;
  repoUrl?: string;
  repoBranch?: string;
  repoName?: string;
  persistenceToken: string;
  demoEnabled?: boolean;
  model: AgentModelOptions<typeof AGENT_CHAT_TASK_ID>;
}
