import { describe, expect, it } from "vitest";

import {
  agentModelKey,
  getAgentModelOptions,
  getAgentReasoningEfforts,
  selectAgentModel,
} from "./agent-models";

describe("agent model selection", () => {
  const options = getAgentModelOptions({
    codexModels: ["gpt-5.6-sol"],
    grokModels: ["grok-4", "grok-code-fast-1", "grok-4"],
  });

  it("keeps provider identity when combining account-discovered models", () => {
    expect(options.map((option) => option.key)).toEqual([
      "openai-codex:gpt-5.6-sol",
      "xai:grok-4",
      "xai:grok-code-fast-1",
    ]);
  });

  it("selects the requested provider model and defaults Grok to its coding model", () => {
    expect(selectAgentModel(options, { provider: "xai" })).toEqual({
      provider: "xai",
      modelId: "grok-code-fast-1",
    });
    expect(agentModelKey(selectAgentModel(options, {
      provider: "xai",
      modelId: "grok-4",
    })!)).toBe("xai:grok-4");
  });

  it("only exposes xAI reasoning effort for Grok 3 Mini", () => {
    expect(getAgentReasoningEfforts({ provider: "xai", modelId: "grok-4" })).toEqual([]);
    expect(getAgentReasoningEfforts({ provider: "xai", modelId: "grok-3-mini" })).toEqual(["low", "high"]);
  });
});
