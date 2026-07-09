import type { ModelMessage } from "ai";
import type { Impersonator, User } from "@workos-inc/node";

export const AGENT_TASK_ID = "autopr-agent";
export const AGENT_STREAM_ID = "assistant-ui";

export interface WorkOSAgentAuth {
  accessToken: string;
  refreshToken: string;
  user: User;
  impersonator?: Impersonator;
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
  demoEnabled?: boolean;
  convexAuth?: WorkOSAgentAuth;
  codex: CodexAgentModelOptions;
}

export interface AgentTaskPayload {
  messages: ModelMessage[];
  options: AgentTaskOptions;
}
