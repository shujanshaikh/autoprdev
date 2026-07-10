import type { ModelMessage } from "ai";

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

export interface CodexAgentModelOptions {
  provider: "openai-codex";
  modelId: string;
  reasoningEffort: string;
  promptCacheKey?: string;
  chatgptCookieHeader: string;
}

export interface AgentTaskOptions {
  projectId?: string;
  threadId?: string;
  sandboxCacheKey: string;
  sandboxId?: string;
  sandboxWorkDir?: string;
  repoUrl?: string;
  repoBranch?: string;
  repoName?: string;
  assistantMessageId?: string;
  persistenceToken?: string;
  demoEnabled?: boolean;
  codex: CodexAgentModelOptions;
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
  sandboxWorkDir?: string;
  repoUrl?: string;
  repoBranch?: string;
  repoName?: string;
  persistenceToken: string;
  demoEnabled?: boolean;
  codex: CodexAgentModelOptions;
}
