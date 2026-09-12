import { v, type Infer } from "convex/values";

export const reasoningEffortValidator = v.union(
  v.literal("low"), v.literal("medium"), v.literal("high"),
  v.literal("xhigh"), v.literal("max"), v.literal("ultra"),
);

export const projectSettingsValidator = v.object({
  model: v.optional(v.object({
    provider: v.union(v.literal("openai-codex"), v.literal("xai")),
    modelId: v.string(),
    reasoningEffort: v.optional(reasoningEffortValidator),
  })),
  workspaceMode: v.union(v.literal("checkout"), v.literal("worktree")),
  computerUseEnabled: v.boolean(),
  subAgentsEnabled: v.boolean(),
  demoEnabled: v.boolean(),
});

export type ProjectSettings = Infer<typeof projectSettingsValidator>;

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  workspaceMode: "checkout",
  computerUseEnabled: true,
  subAgentsEnabled: true,
  demoEnabled: false,
};

/** Snapshot defaults when creating a thread so later project edits do not change it. */
export function resolveProjectSettings(settings?: ProjectSettings): ProjectSettings {
  return settings ?? DEFAULT_PROJECT_SETTINGS;
}

/** Provider reasoning capabilities shared by project settings and both clients. */
export function getProjectReasoningEfforts(model: ProjectSettings["model"]): readonly Infer<typeof reasoningEffortValidator>[] {
  if (!model) return [];
  const id = model.modelId.toLowerCase();
  if (model.provider === "openai-codex") {
    if (id === "gpt-5.6-sol" || id === "gpt-5.6-terra") return ["low", "medium", "high", "xhigh", "max", "ultra"];
    if (id === "gpt-5.6-luna") return ["low", "medium", "high", "xhigh", "max"];
    return ["low", "medium", "high", "xhigh"];
  }
  if (id.includes("grok-4.20") && id.includes("multi-agent")) return ["low", "medium", "high", "xhigh"];
  if (id.includes("non-reasoning")) return [];
  if (id.includes("grok-4.5") || id.includes("grok-4.3") || id.includes("grok-4.20")) return ["low", "medium", "high"];
  return id.includes("grok-3-mini") ? ["low", "high"] : [];
}
