import "@tanstack/react-start/server-only";

import { createCodexResponsesModel, revokeCodexAgentGrant } from "#/lib/codex-auth-runtime-server";
import { createGrokResponsesModel, revokeGrokAgentGrant } from "#/lib/grok-auth-runtime-server";
import { isAgentReasoningEffortSupported } from "#/lib/agent-models";
import type { AgentModelOptions } from "#/lib/trigger-agent-contract";

export interface AgentAuthDependencies {
  createCodexResponsesModel: typeof createCodexResponsesModel;
  createGrokResponsesModel: typeof createGrokResponsesModel;
  revokeCodexAgentGrant: typeof revokeCodexAgentGrant;
  revokeGrokAgentGrant: typeof revokeGrokAgentGrant;
}

const defaultDependencies: AgentAuthDependencies = {
  createCodexResponsesModel,
  createGrokResponsesModel,
  revokeCodexAgentGrant,
  revokeGrokAgentGrant,
};

export function createAgentResponsesModel(
  options: AgentModelOptions,
  dependencies: AgentAuthDependencies = defaultDependencies,
) {
  if (options.provider !== "xai") {
    return dependencies.createCodexResponsesModel(options);
  }

  const reasoningEffort = isAgentReasoningEffortSupported(options, options.reasoningEffort)
    ? options.reasoningEffort
    : undefined;
  return dependencies.createGrokResponsesModel({ ...options, reasoningEffort });
}

export function revokeAgentModelGrant(
  options: AgentModelOptions,
  dependencies: AgentAuthDependencies = defaultDependencies,
) {
  return options.provider === "xai"
    ? dependencies.revokeGrokAgentGrant(options.credentialsGrantId)
    : dependencies.revokeCodexAgentGrant(options.credentialsGrantId);
}

export function agentProviderOptions(
  options: AgentModelOptions,
  instructions: string,
) {
  if (options.provider === "xai") {
    const reasoningEffort = isAgentReasoningEffortSupported(options, options.reasoningEffort)
      ? options.reasoningEffort
      : undefined;
    return {
      xai: {
        // The current AI SDK schema stops at `high`; the OAuth transport
        // injects xAI's multi-agent-only `xhigh` value directly.
        reasoningEffort: reasoningEffort === "xhigh" ? undefined : reasoningEffort,
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
