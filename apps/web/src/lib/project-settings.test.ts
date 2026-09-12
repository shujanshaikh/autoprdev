import { describe, expect, it, vi } from "vitest";
import type { FunctionArgs } from "convex/server";
import { api } from "@autopr/backend/convex/_generated/api";
import type { Doc } from "@autopr/backend/convex/_generated/dataModel";
import { updateAgentSettings } from "@autopr/backend/convex/projects";
import { create, setAgentModelSelection, setDemoEnabled } from "@autopr/backend/convex/threads";
import { DEFAULT_PROJECT_SETTINGS, type ProjectSettings } from "@autopr/backend/convex/lib/projectSettings";
import { resolveThreadModelRequest } from "./thread-agent-settings";

const update = updateAgentSettings as unknown as {
  _handler: (ctx: unknown, args: FunctionArgs<typeof api.projects.updateAgentSettings>) => Promise<null>;
};
const createThread = create as unknown as {
  _handler: (ctx: unknown, args: FunctionArgs<typeof api.threads.create>) => Promise<string>;
};
const setDemo = setDemoEnabled as unknown as {
  _handler: (ctx: unknown, args: FunctionArgs<typeof api.threads.setDemoEnabled>) => Promise<null>;
};
const setModel = setAgentModelSelection as unknown as {
  _handler: (ctx: unknown, args: FunctionArgs<typeof api.threads.setAgentModelSelection>) => Promise<null>;
};

const settings: ProjectSettings = {
  model: { provider: "openai-codex", modelId: "gpt-5.6-sol", reasoningEffort: "ultra" },
  workspaceMode: "worktree", computerUseEnabled: false, subAgentsEnabled: false, demoEnabled: false,
};

function context(agentSettings?: ProjectSettings) {
  const project = {
    _id: "project-row", projectId: "project-1", authorId: "owner", sandboxStatus: "ready",
    repoName: "app", currentBranch: "main", sandboxWorkDir: "/workspace/app", agentSettings,
  };
  const threads: Partial<Doc<"threads">>[] = [];
  const patch = vi.fn(async (id: string, values: object) => {
    Object.assign(id === project._id ? project : threads[0]!, values);
  });
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "owner" }) },
    db: {
      query: (table: string) => ({ withIndex: () => ({ unique: async () =>
        table === "projects" ? project : table === "threads" ? threads[0] : { demoRecordingExperimentEnabled: false },
      }) }),
      patch,
      insert: vi.fn(async (_table: string, values: Partial<Doc<"threads">>) => {
        threads.push(structuredClone(values));
      }),
    },
  };
  return { ctx, project, threads, patch };
}

describe("project agent settings", () => {
  it("copies project defaults into new threads and preserves existing threads after settings change", async () => {
    const { ctx, threads } = context(settings);
    await createThread._handler(ctx, { projectId: "project-1" });
    expect(threads[0]).toMatchObject({
      agentProvider: "openai-codex", agentModel: "gpt-5.6-sol", agentReasoningEffort: "ultra",
      workspaceMode: "worktree", agentSettings: settings, demoEnabled: false,
    });
    await update._handler(ctx, { projectId: "project-1", settings: DEFAULT_PROJECT_SETTINGS });
    await createThread._handler(ctx, { projectId: "project-1" });
    expect(threads[0]?.agentSettings).toEqual(settings);
    expect(threads[1]).toMatchObject({ workspaceMode: "checkout", agentSettings: DEFAULT_PROJECT_SETTINGS });
  });

  it("uses explicit thread overrides without carrying reasoning from a different project model", async () => {
    const { ctx, threads } = context(settings);
    await createThread._handler(ctx, {
      projectId: "project-1", agentProvider: "xai", agentModel: "grok-4.3", workspaceMode: "checkout",
    });
    expect(threads[0]).toMatchObject({ agentProvider: "xai", agentModel: "grok-4.3", workspaceMode: "checkout" });
    expect(threads[0]?.agentReasoningEffort).toBeUndefined();
    expect(threads[0]?.agentSettings?.computerUseEnabled).toBe(false);
  });

  it("inherits reasoning when a client sends the project model without an effort", async () => {
    const { ctx, threads } = context(settings);
    await createThread._handler(ctx, { projectId: "project-1", agentProvider: "openai-codex", agentModel: "gpt-5.6-sol" });
    expect(threads[0]?.agentReasoningEffort).toBe("ultra");
  });

  it("resets defaults and keeps legacy projects usable", async () => {
    const { ctx, project, threads } = context(settings);
    await update._handler(ctx, { projectId: "project-1", settings: null });
    expect(project.agentSettings).toBeUndefined();
    await createThread._handler(ctx, { projectId: "project-1" });
    expect(threads[0]).toMatchObject({ workspaceMode: "checkout", demoEnabled: false, agentSettings: DEFAULT_PROJECT_SETTINGS });
  });

  it("only lets the project owner save defaults", async () => {
    const { ctx, project, patch } = context();
    project.authorId = "someone-else";
    await expect(update._handler(ctx, { projectId: "project-1", settings })).rejects.toThrow("UNAUTHORIZED");
    expect(patch).not.toHaveBeenCalled();
  });

  it("rejects unsupported reasoning and recording without computer use or Labs access", async () => {
    const { ctx, patch } = context(settings);
    await expect(update._handler(ctx, { projectId: "project-1", settings: {
      ...settings, model: { provider: "xai", modelId: "grok-4.3", reasoningEffort: "ultra" },
    } })).rejects.toThrow("INVALID_REASONING_EFFORT");
    await expect(update._handler(ctx, { projectId: "project-1", settings: { ...settings, demoEnabled: true } })).rejects.toThrow("COMPUTER_USE_DISABLED");
    await expect(update._handler(ctx, { projectId: "project-1", settings: {
      ...settings, computerUseEnabled: true, demoEnabled: true,
    } })).rejects.toThrow("DEMO_RECORDING_EXPERIMENT_DISABLED");
    expect(patch).not.toHaveBeenCalled();
    await createThread._handler(ctx, { projectId: "project-1" });
    await expect(setDemo._handler(ctx, { threadId: "thread-1", demoEnabled: true })).rejects.toThrow("COMPUTER_USE_DISABLED");
  });

  it("does not prevent new threads when Labs was disabled after setting a recording default", async () => {
    const { ctx, threads } = context({ ...settings, computerUseEnabled: true, demoEnabled: true });
    await createThread._handler(ctx, { projectId: "project-1" });
    expect(threads[0]?.demoEnabled).toBe(false);
  });
});

describe("per-turn model selection", () => {
  const thread = { agentProvider: "openai-codex", agentModel: "gpt-5.6-sol", agentReasoningEffort: "ultra" } as const;
  it.each([
    { provider: "openai-codex", model: "gpt-5.5", reasoningEffort: undefined },
    { provider: "xai", model: "grok-4", reasoningEffort: undefined },
    { provider: "openai-codex", model: "gpt-5.6-terra", reasoningEffort: "ultra" },
  ] as const)("keeps saved reasoning compatible after switching to $model", async ({ provider, model, reasoningEffort }) => {
    const { ctx, threads } = context(settings);
    const threadId = await createThread._handler(ctx, { projectId: "project-1" });
    await setModel._handler(ctx, { threadId, provider, model });

    expect(threads[0]?.agentReasoningEffort).toBe(reasoningEffort);
    expect(resolveThreadModelRequest(threads[0]!, {})).toEqual({ provider, model, reasoningEffort });
  });

  it("uses persisted defaults when API callers omit their model", () => {
    expect(resolveThreadModelRequest(thread, {})).toEqual({ provider: "openai-codex", model: "gpt-5.6-sol", reasoningEffort: "ultra" });
  });
  it("keeps explicit overrides and drops incompatible inherited reasoning", () => {
    expect(resolveThreadModelRequest(thread, { provider: "xai", model: "grok-4.3" })).toEqual({ provider: "xai", model: "grok-4.3", reasoningEffort: undefined });
    expect(resolveThreadModelRequest(thread, { reasoningEffort: "low" }).reasoningEffort).toBe("low");
  });
});
