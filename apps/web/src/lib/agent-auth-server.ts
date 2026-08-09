import "@tanstack/react-start/server-only";

import type { AgentProvider } from "#/lib/agent-models";
import {
  codexErrorResponse,
  createCodexAgentModelOptions,
  revokeCodexAgentModelOptions,
} from "#/lib/codex-auth-server";
import {
  createGrokAgentModelOptions,
  grokErrorResponse,
  revokeGrokAgentModelOptions,
} from "#/lib/grok-auth-server";
import type { AgentModelOptions } from "#/lib/trigger-agent-contract";

export async function createAgentModelOptions<TTaskId extends "autopr-agent" | "autopr-chat-agent">(
  request: Request,
  provider: AgentProvider | undefined,
  modelId: string | undefined,
  reasoningEffort: string | undefined,
  grantContext: { taskId: TTaskId; contextId: string },
): Promise<AgentModelOptions<TTaskId>> {
  if (provider === "xai") {
    const options = await createGrokAgentModelOptions(modelId, grantContext);
    return reasoningEffort === "low" || reasoningEffort === "high"
      ? { ...options, reasoningEffort }
      : options;
  }
  return createCodexAgentModelOptions(request, modelId, reasoningEffort, grantContext);
}

export function revokeAgentModelOptions(options: AgentModelOptions) {
  return options.provider === "xai"
    ? revokeGrokAgentModelOptions(options)
    : revokeCodexAgentModelOptions(options);
}

export function agentAuthErrorResponse(error: unknown, fallback: string) {
  if (error instanceof Error && (error.name === "GrokConnectionError" || error.name === "GrokOAuthError")) {
    return grokErrorResponse(error, fallback);
  }
  return codexErrorResponse(error, fallback);
}
