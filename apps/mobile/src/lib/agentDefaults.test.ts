import { describe, expect, it } from "vitest";
import { resolveAgentDefaults } from "./agentDefaults";

describe("mobile project defaults", () => {
  it("inherits the project model and reasoning after project data loads", () => {
    const result = resolveAgentDefaults({
      savedModel: { provider: "openai-codex", modelId: "gpt-5.6-terra", reasoningEffort: "ultra" },
      codexModels: ["gpt-5.6-sol", "gpt-5.6-terra"],
    });
    expect(result).toMatchObject({ provider: "openai-codex", model: "gpt-5.6-terra", reasoningEffort: "ultra" });
  });

  it("keeps a saved Grok provider and lets a user override it with Codex", () => {
    const savedModel = { provider: "xai", modelId: "grok-4.3", reasoningEffort: "high" } as const;
    expect(resolveAgentDefaults({ savedModel })).toMatchObject({ provider: "xai", model: "grok-4.3", reasoningEffort: "high" });
    expect(resolveAgentDefaults({ savedModel, modelChoice: "gpt-5.5", codexModels: ["gpt-5.5"] }))
      .toMatchObject({ provider: "openai-codex", model: "gpt-5.5", reasoningEffort: "low" });
  });

  it("drops unsupported reasoning when a model changes or has no reasoning control", () => {
    expect(resolveAgentDefaults({
      savedModel: { provider: "openai-codex", modelId: "gpt-5.6-sol", reasoningEffort: "ultra" },
      modelChoice: "gpt-5.5", reasoningChoice: "ultra", codexModels: ["gpt-5.5"],
    }).reasoningEffort).toBe("low");
    expect(resolveAgentDefaults({ savedModel: { provider: "xai", modelId: "grok-4" } }))
      .toMatchObject({ reasoningOptions: [], reasoningEffort: undefined });
  });
});
