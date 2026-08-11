import { describe, expect, it } from "vitest";

import {
  agentModelKey,
  getAgentModelOptions,
  getAgentContextLimit,
  getAgentReasoningEfforts,
  selectAgentReasoningEffort,
  selectAgentModel,
} from "./agent-models";

describe("agent model selection", () => {
  const options = getAgentModelOptions({
    codexModels: ["gpt-5.6-sol"],
    grokModels: ["grok-4", "grok-code-fast-1", "grok-4.5", "grok-4"],
  });

  it("keeps provider identity when combining account-discovered models", () => {
    expect(options.map((option) => option.key)).toEqual([
      "openai-codex:gpt-5.6-sol",
      "xai:grok-4",
      "xai:grok-code-fast-1",
      "xai:grok-4.5",
    ]);
  });

  it("selects the requested provider model and defaults Grok to its latest frontier model", () => {
    expect(selectAgentModel(options, { provider: "xai" })).toEqual({
      provider: "xai",
      modelId: "grok-4.5",
    });
    expect(agentModelKey(selectAgentModel(options, {
      provider: "xai",
      modelId: "grok-4",
    })!)).toBe("xai:grok-4");
  });

  it("exposes the reasoning efforts supported by each Grok family", () => {
    expect(getAgentReasoningEfforts({ provider: "xai", modelId: "grok-4" })).toEqual([]);
    expect(getAgentReasoningEfforts({ provider: "xai", modelId: "grok-4.5" })).toEqual(["low", "medium", "high"]);
    expect(getAgentReasoningEfforts({ provider: "xai", modelId: "grok-4.20-multi-agent-beta" })).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(getAgentReasoningEfforts({ provider: "xai", modelId: "grok-4.20-0309-non-reasoning" })).toEqual([]);
    expect(getAgentReasoningEfforts({ provider: "xai", modelId: "grok-3-mini" })).toEqual(["low", "high"]);
  });

  it("defaults capable Grok models to high reasoning while preserving an explicit choice", () => {
    const selection = { provider: "xai" as const, modelId: "grok-4.5" };
    expect(selectAgentReasoningEffort(selection, undefined)).toBe("high");
    expect(selectAgentReasoningEffort(selection, "medium")).toBe("medium");
  });

  it("uses provider-specific context windows", () => {
    expect(getAgentContextLimit({ provider: "openai-codex", modelId: "gpt-5.6-sol" })).toBe(272_000);
    expect(getAgentContextLimit({ provider: "openai-codex", modelId: "gpt-5.6-terra" })).toBe(272_000);
    expect(getAgentContextLimit({ provider: "openai-codex", modelId: "gpt-5.6-luna" })).toBe(272_000);
    expect(getAgentContextLimit({ provider: "xai", modelId: "grok-4.5" })).toBe(500_000);
    expect(getAgentContextLimit({ provider: "xai", modelId: "grok-build-latest" })).toBe(500_000);
    expect(getAgentContextLimit({ provider: "xai", modelId: "grok-4.20-multi-agent-beta" })).toBe(1_000_000);
    expect(getAgentContextLimit({ provider: "xai", modelId: "grok-4.3" })).toBe(1_000_000);
    expect(getAgentContextLimit({ provider: "xai", modelId: "grok-build-0.1" })).toBe(256_000);
    expect(getAgentContextLimit({ provider: "xai", modelId: "grok-4" })).toBe(256_000);
  });
});
