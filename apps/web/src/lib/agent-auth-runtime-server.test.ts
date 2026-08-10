import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("#/lib/codex-auth-runtime-server", () => ({
  createCodexResponsesModel: vi.fn(),
  revokeCodexAgentGrant: vi.fn(),
}));
vi.mock("#/lib/grok-auth-runtime-server", () => ({
  createGrokResponsesModel: vi.fn(),
  revokeGrokAgentGrant: vi.fn(),
}));

import { agentProviderOptions, agentSystemPrompt } from "./agent-auth-runtime-server";
import type { AgentModelOptions } from "./trigger-agent-contract";

const grantContext = {
  userId: "user-1",
  taskId: "autopr-agent" as const,
  contextId: "thread-1",
};

describe("agent provider prompt routing", () => {
  it("sends OpenAI instructions exactly once through the Responses request", () => {
    const model: AgentModelOptions = {
      provider: "openai-codex",
      modelId: "gpt-5.6-sol",
      reasoningEffort: "high",
      promptCacheKey: "thread-1",
      credentialsGrantId: "grant-1",
      credentialsGrantContext: grantContext,
    };

    expect(agentSystemPrompt(model, "system instructions")).toBeUndefined();
    expect(agentProviderOptions(model, "system instructions")).toMatchObject({
      openai: {
        instructions: "system instructions",
        promptCacheKey: "thread-1",
        store: false,
      },
    });
  });

  it("uses a system message for xAI and leaves cache injection to the OAuth transport", () => {
    const model: AgentModelOptions = {
      provider: "xai",
      modelId: "grok-4.5",
      reasoningEffort: "high",
      promptCacheKey: "thread-1",
      credentialsGrantId: "grant-1",
      credentialsGrantContext: grantContext,
    };

    expect(agentSystemPrompt(model, "system instructions")).toBe("system instructions");
    expect(agentProviderOptions(model, "system instructions")).toEqual({
      xai: { reasoningEffort: "high", store: false },
    });
  });

  it("leaves xhigh for the transport shim because the AI SDK schema does not expose it", () => {
    const model: AgentModelOptions = {
      provider: "xai",
      modelId: "grok-4.20-multi-agent-0309",
      reasoningEffort: "xhigh",
      credentialsGrantId: "grant-1",
      credentialsGrantContext: grantContext,
    };

    expect(agentProviderOptions(model, "system instructions")).toEqual({
      xai: { reasoningEffort: undefined, store: false },
    });
  });
});
