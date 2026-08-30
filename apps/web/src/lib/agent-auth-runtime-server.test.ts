import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const createCodexResponsesModel = vi.fn((options: { modelId: string }) => ({
    modelId: options.modelId,
  }));
  return {
    createCodexResponsesModel,
  };
});

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("#/lib/codex-auth-runtime-server", () => ({
  createCodexResponsesModel: mocks.createCodexResponsesModel,
  revokeCodexAgentGrant: vi.fn(),
}));
vi.mock("#/lib/grok-auth-runtime-server", () => ({
  createGrokResponsesModel: vi.fn(),
  revokeGrokAgentGrant: vi.fn(),
}));

import { createGrokResponsesModel } from "#/lib/grok-auth-runtime-server";
import {
  agentProviderOptions,
  agentSystemPrompt,
  createAgentResponseModels,
  createAgentResponsesModel,
} from "./agent-auth-runtime-server";
import type { AgentModelOptions } from "./trigger-agent-contract";

const grantContext = {
  userId: "user-1",
  taskId: "autopr-agent" as const,
  contextId: "thread-1",
};

describe("agent provider prompt routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses the parent's authenticated ChatGPT model for sub-agents", async () => {
    const model: AgentModelOptions = {
      provider: "openai-codex",
      modelId: "gpt-5.6-sol",
      reasoningEffort: "high",
      promptCacheKey: "thread-1",
      credentialsGrantId: "grant-1",
      credentialsGrantContext: grantContext,
    };

    const models = await createAgentResponseModels(model);

    expect(mocks.createCodexResponsesModel).toHaveBeenCalledOnce();
    expect(mocks.createCodexResponsesModel).toHaveBeenCalledWith(model);
    expect(models.parent).toBe(models.subAgent);
    expect(models.subAgentOptions).toBe(model);
  });

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

  it("leaves max reasoning to the authenticated Codex transport", () => {
    const model: AgentModelOptions = {
      provider: "openai-codex",
      modelId: "gpt-5.6-luna",
      reasoningEffort: "max",
      credentialsGrantId: "grant-1",
      credentialsGrantContext: grantContext,
    };

    expect(agentProviderOptions(model, "system instructions")).toMatchObject({
      openai: { reasoningEffort: undefined },
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
    void createAgentResponsesModel(model);
    expect(createGrokResponsesModel).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: "xhigh" }));
  });

  it("removes xhigh from Grok models that do not support it", () => {
    const model: AgentModelOptions = {
      provider: "xai",
      modelId: "grok-4.5",
      reasoningEffort: "xhigh",
      credentialsGrantId: "grant-1",
      credentialsGrantContext: grantContext,
    };

    void createAgentResponsesModel(model);
    expect(createGrokResponsesModel).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: undefined }));
  });
});
