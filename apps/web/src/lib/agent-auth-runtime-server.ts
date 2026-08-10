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
        // The current AI SDK schema stops at `high`; the OAuth transport
        // injects xAI's multi-agent-only `xhigh` value directly.
        reasoningEffort: options.reasoningEffort === "xhigh" ? undefined : options.reasoningEffort,
        store: false,
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

/** OpenAI receives this through Responses `instructions`; xAI uses a system message. */
export function agentSystemPrompt(options: AgentModelOptions, instructions: string) {
  return options.provider === "xai" ? instructions : undefined;
}
