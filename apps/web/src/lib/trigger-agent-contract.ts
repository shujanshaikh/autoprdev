import type { ModelMessage } from "ai";

export const AGENT_TASK_ID = "autopr-agent";
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
