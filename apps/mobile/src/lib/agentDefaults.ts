import { getProjectReasoningEfforts, type ProjectSettings } from "@autopr/backend/convex/lib/projectSettings";
import { getCodexModelOptions, selectCodexModel } from "./codexModels";

/** Preserve saved provider defaults until the user chooses a different model. */
export function resolveAgentDefaults({ savedModel, modelChoice, reasoningChoice, codexModels }: {
  savedModel?: ProjectSettings["model"];
  modelChoice?: string;
  reasoningChoice?: string;
  codexModels?: readonly string[];
}) {
  const provider = !modelChoice || modelChoice === savedModel?.modelId
    ? savedModel?.provider ?? "openai-codex" : "openai-codex";
  const model = provider === "xai" ? savedModel?.modelId
    : selectCodexModel(codexModels, modelChoice ?? savedModel?.modelId);
  const requestedReasoning = reasoningChoice ?? (model === savedModel?.modelId ? savedModel?.reasoningEffort : undefined);
  const reasoningOptions = getProjectReasoningEfforts(model ? { provider, modelId: model } : undefined);
  const reasoningEffort = reasoningOptions.find((effort) => effort === requestedReasoning)
    ?? (provider === "xai" && reasoningOptions.includes("high") ? "high" : reasoningOptions[0]);
  const modelOptions = getCodexModelOptions(getCodexModelOptions(codexModels, savedModel?.modelId), model);
  return { provider, model, modelOptions, reasoningOptions, reasoningEffort };
}
