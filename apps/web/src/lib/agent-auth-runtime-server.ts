import "@tanstack/react-start/server-only";

import { createCodexResponsesModel, revokeCodexAgentGrant } from "#/lib/codex-auth-runtime-server";
import { createGrokResponsesModel, revokeGrokAgentGrant } from "#/lib/grok-auth-runtime-server";
import type { AgentModelOptions } from "#/lib/trigger-agent-contract";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue | undefined };
type ProviderOptions = Record<string, { [key: string]: JsonValue | undefined }>;

export function createAgentResponsesModel(options: AgentModelOptions) {
  return options.provider === "xai"
    ? createGrokResponsesModel(options)
    : createCodexResponsesModel(options);
}

export function revokeAgentModelGrant(options: AgentModelOptions) {
  return options.provider === "xai"
    ? revokeGrokAgentGrant(options.credentialsGrantId)
    : revokeCodexAgentGrant(options.credentialsGrantId);
}

export function agentProviderOptions(
  options: AgentModelOptions,
  instructions: string,
): ProviderOptions {
  if (options.provider === "xai") {
    return {
      xai: {
        promptCacheKey: options.promptCacheKey,
        reasoningEffort: options.reasoningEffort,
      },
    };
  }
  return {
    openai: {
      store: false,
      instructions,
      parallelToolCalls: true,
      promptCacheKey: options.promptCacheKey,
      reasoningEffort: options.reasoningEffort,
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    },
  };
}
