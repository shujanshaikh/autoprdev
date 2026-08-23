import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import {
  collectAssistantPartsBlobKeys,
  deleteAssistantPartsBlobKeys,
  type AssistantPartsBlobDeleteCtx,
} from "./lib/assistantPartsBlobs";
import { requireUserId } from "./lib/auth";
import {
  resolvedSandboxProvider,
  sandboxProviderValidator,
} from "./lib/sandboxProvider";
import { randomUuid } from "./lib/uuid";

const shortError = (message: string) => message.slice(0, 700);
const sandboxStatusValidator = v.union(v.literal("creating"), v.literal("ready"), v.literal("failed"));
const sandboxRuntimeStatusValidator = v.union(
  v.literal("started"),
  v.literal("stopped"),
  v.literal("archived"),
  v.literal("unknown"),
);
const sandboxSecretValidator = v.object({
  envName: v.string(),
  secretId: v.string(),
  secretName: v.string(),
  hosts: v.array(v.string()),
  updatedAt: v.number(),
});
const sandboxEnvironmentVariableValidator = v.object({
  envName: v.string(),
  updatedAt: v.number(),
});
type SandboxStatus = "creating" | "ready" | "failed";

function projectRecency(project: { lastOpenedAt?: number; updatedAt: number; createdAt: number }) {
  return project.lastOpenedAt ?? project.updatedAt ?? project.createdAt;
}

export const ensureForGithubRepoInternal = internalMutation({
  args: {
    authorId: v.string(),
    githubUrl: v.string(),
    cloneUrl: v.string(),
    repoFullName: v.string(),
    repoOwner: v.string(),
    repoName: v.string(),
    repoBranch: v.optional(v.string()),
  },
  returns: v.object({
    projectId: v.string(),
    created: v.boolean(),
    sandboxStatus: sandboxStatusValidator,
    sandboxProvider: sandboxProviderValidator,
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_author_repo", (q) => q.eq("authorId", args.authorId).eq("repoFullName", args.repoFullName))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastOpenedAt: now,
        updatedAt: now,
      });

      return {
        projectId: existing.projectId,
        created: false,
        sandboxStatus: existing.sandboxStatus as SandboxStatus,
        sandboxProvider: resolvedSandboxProvider(existing.sandboxProvider),
      };
    }

    const projectId = randomUuid();
    await ctx.db.insert("projects", {
      projectId,
      authorId: args.authorId,
      githubUrl: args.githubUrl,
      cloneUrl: args.cloneUrl,
      repoFullName: args.repoFullName,
      repoOwner: args.repoOwner,
      repoName: args.repoName,
      repoBranch: args.repoBranch,
      sandboxCacheKey: projectId,
      sandboxProvider: "daytona",
      sandboxStatus: "creating",
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    });

    return {
      projectId,
      created: true,
      sandboxStatus: "creating" as const,
      sandboxProvider: "daytona" as const,
    };
  },
});

export const ensureForGithubSelection = mutation({
  args: {
    githubRepositoryId: v.number(),
    githubUrl: v.string(),
    cloneUrl: v.string(),
    repoFullName: v.string(),
    repoOwner: v.string(),
    repoName: v.string(),
    defaultBranch: v.string(),
    repoBranch: v.string(),
    sandboxProvider: sandboxProviderValidator,
  },
  returns: v.object({
    projectId: v.string(),
    created: v.boolean(),
    sandboxStatus: sandboxStatusValidator,
    sandboxId: v.optional(v.string()),
    sandboxWorkDir: v.optional(v.string()),
    sandboxProvider: sandboxProviderValidator,
  }),
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const now = Date.now();
    const repoFullName = `${args.repoOwner}/${args.repoName}`.toLowerCase();
    const githubUrl = `https://github.com/${args.repoOwner}/${args.repoName}`;
    const cloneUrl = `${githubUrl}.git`;

    if (
      args.repoFullName !== repoFullName ||
      args.githubUrl !== githubUrl ||
      args.cloneUrl !== cloneUrl ||
      !args.defaultBranch.trim() ||
      !args.repoBranch.trim()
    ) {
      throw new ConvexError({ code: "INVALID_GITHUB_REPOSITORY" });
    }

    const existing = await ctx.db
      .query("projects")
      .withIndex("by_author_repo", (q) => q.eq("authorId", authorId).eq("repoFullName", args.repoFullName))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        githubProvider: "oauth",
        githubRepositoryId: args.githubRepositoryId,
        githubUrl: args.githubUrl,
        cloneUrl: args.cloneUrl,
        repoOwner: args.repoOwner,
        repoName: args.repoName,
        defaultBranch: args.defaultBranch,
        lastOpenedAt: now,
        updatedAt: now,
      });

      return {
        projectId: existing.projectId,
        created: false,
        sandboxStatus: existing.sandboxStatus as SandboxStatus,
        sandboxId: existing.sandboxId,
        sandboxWorkDir: existing.sandboxWorkDir,
        sandboxProvider: resolvedSandboxProvider(existing.sandboxProvider),
      };
    }

    const projectId = randomUuid();
    await ctx.db.insert("projects", {
      projectId,
      authorId,
      githubUrl: args.githubUrl,
      cloneUrl: args.cloneUrl,
      repoFullName: args.repoFullName,
      repoOwner: args.repoOwner,
      repoName: args.repoName,
      repoBranch: args.repoBranch,
      githubProvider: "oauth",
      githubRepositoryId: args.githubRepositoryId,
      defaultBranch: args.defaultBranch,
      currentBranch: args.repoBranch,
      branchSwitchStatus: "idle",
      sandboxCacheKey: projectId,
      sandboxProvider: args.sandboxProvider,
      sandboxStatus: "creating",
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    });

    return {
      projectId,
      created: true,
      sandboxStatus: "creating" as const,
      sandboxProvider: args.sandboxProvider,
    };
  },
});

export const markSandboxReadyInternal = internalMutation({
  args: {
    authorId: v.string(),
    projectId: v.string(),
    sandboxId: v.string(),
    sandboxProvider: sandboxProviderValidator,
    sandboxName: v.optional(v.string()),
    sandboxSnapshot: v.optional(v.string()),
    sandboxWorkDir: v.optional(v.string()),
    e2bCpuCount: v.optional(v.number()),
    e2bMemoryMB: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== args.authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    await ctx.db.patch(project._id, {
      sandboxId: args.sandboxId,
      sandboxName: args.sandboxName,
      sandboxSnapshot: args.sandboxSnapshot,
      sandboxWorkDir: args.sandboxWorkDir,
      sandboxProvider: args.sandboxProvider,
      sandboxStatus: "ready",
      sandboxRuntimeStatus: "started",
      sandboxRuntimeCheckedAt: Date.now(),
      branchSwitchStatus: "idle",
      sandboxError: undefined,
      updatedAt: Date.now(),
    });
    await ctx.runMutation(internal.sandboxCosts.upsertWhenSandboxReadyInternal, {
      authorId: args.authorId,
      projectId: args.projectId,
      sandboxId: args.sandboxId,
      sandboxName: args.sandboxName,
      repoFullName: project.repoFullName,
      sandboxProvider: args.sandboxProvider,
      e2bCpuCount: args.e2bCpuCount,
      e2bMemoryMB: args.e2bMemoryMB,
      sandboxCreatedAt: project.createdAt,
    });

    return null;
  },
});

export const getSandboxBindingTargetInternal = internalQuery({
  args: {
    authorId: v.string(),
    projectId: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== args.authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    return {
      projectId: project.projectId,
      repoName: project.repoName,
      cloneUrl: project.cloneUrl,
      sandboxProvider: resolvedSandboxProvider(project.sandboxProvider),
    };
  },
});

export const markSandboxFailedInternal = internalMutation({
  args: {
    authorId: v.string(),
    projectId: v.string(),
    sandboxError: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== args.authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    await ctx.db.patch(project._id, {
      sandboxStatus: "failed",
      sandboxError: shortError(args.sandboxError),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markSandboxFailed = mutation({
  args: {
    projectId: v.string(),
    sandboxError: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    await ctx.db.patch(project._id, {
      sandboxStatus: "failed",
      sandboxError: shortError(args.sandboxError),
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const get = query({
  args: {
    projectId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== identity.subject) {
      return null;
    }

    return project;
  },
});

export const latest = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_author", (q) => q.eq("authorId", identity.subject))
      .collect();

    return projects.reduce((latestProject, project) => {
      if (!latestProject) {
        return project;
      }

      return projectRecency(project) > projectRecency(latestProject) ? project : latestProject;
    }, null as (typeof projects)[number] | null);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_author", (q) => q.eq("authorId", identity.subject))
      .order("desc")
      .collect();
    const costs = await ctx.db
      .query("sandboxCosts")
      .withIndex("by_author", (q) => q.eq("authorId", identity.subject))
      .collect();
    const costBySandboxId = new Map(costs.map((cost) => [cost.sandboxId, cost]));
    return projects.map((project) => ({
      ...project,
      sandboxCost: project.sandboxId ? costBySandboxId.get(project.sandboxId) ?? null : null,
    }));
  },
});

export const markOpened = mutation({
  args: {
    projectId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    await ctx.db.patch(project._id, {
      lastOpenedAt: Date.now(),
    });

    return null;
  },
});

export const markBranchSwitching = mutation({
  args: {
    projectId: v.string(),
    repoBranch: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    await ctx.db.patch(project._id, {
      repoBranch: args.repoBranch,
      currentBranch: args.repoBranch,
      branchSwitchStatus: "switching",
      branchSwitchError: undefined,
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const markBranchSwitchReady = mutation({
  args: {
    projectId: v.string(),
    repoBranch: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    await ctx.db.patch(project._id, {
      repoBranch: args.repoBranch,
      currentBranch: args.repoBranch,
      branchSwitchStatus: "idle",
      branchSwitchError: undefined,
      branchSwitchedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const markBranchSwitchFailed = mutation({
  args: {
    projectId: v.string(),
    branchSwitchError: v.string(),
    previousBranch: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    await ctx.db.patch(project._id, {
      branchSwitchStatus: "failed",
      branchSwitchError: shortError(args.branchSwitchError),
      repoBranch: args.previousBranch ?? project.repoBranch,
      currentBranch: args.previousBranch ?? project.currentBranch,
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const updateSandboxRuntimeStatusInternal = internalMutation({
  args: {
    authorId: v.string(),
    projectId: v.string(),
    sandboxRuntimeStatus: sandboxRuntimeStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== args.authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    await ctx.db.patch(project._id, {
      sandboxRuntimeStatus: args.sandboxRuntimeStatus,
      sandboxRuntimeCheckedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const getDesktopSandboxInternal = internalQuery({
  args: {
    authorId: v.string(),
    projectId: v.string(),
  },
  returns: v.object({
    sandboxId: v.string(),
    sandboxProvider: sandboxProviderValidator,
    repoName: v.string(),
    sandboxWorkDir: v.optional(v.string()),
    sandboxRuntimeStatus: v.optional(sandboxRuntimeStatusValidator),
    sandboxRuntimeCheckedAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== args.authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    if (project.sandboxStatus !== "ready" || !project.sandboxId) {
      throw new ConvexError({ code: "PROJECT_SANDBOX_NOT_READY" });
    }

    return {
      sandboxId: project.sandboxId,
      sandboxProvider: resolvedSandboxProvider(project.sandboxProvider),
      repoName: project.repoName,
      sandboxWorkDir: project.sandboxWorkDir,
      sandboxRuntimeStatus: project.sandboxRuntimeStatus,
      sandboxRuntimeCheckedAt: project.sandboxRuntimeCheckedAt,
    };
  },
});

export const getSandboxEnvironmentInternal = internalQuery({
  args: {
    authorId: v.string(),
    projectId: v.string(),
  },
  returns: v.object({
    sandboxId: v.string(),
    sandboxProvider: sandboxProviderValidator,
    repoFullName: v.string(),
    sandboxSecrets: v.array(sandboxSecretValidator),
    sandboxEnvironmentVariables: v.array(sandboxEnvironmentVariableValidator),
  }),
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== args.authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    if (project.sandboxStatus !== "ready" || !project.sandboxId) {
      throw new ConvexError({ code: "PROJECT_SANDBOX_NOT_READY" });
    }

    return {
      sandboxId: project.sandboxId,
      sandboxProvider: resolvedSandboxProvider(project.sandboxProvider),
      repoFullName: project.repoFullName,
      sandboxSecrets: project.sandboxSecrets ?? [],
      sandboxEnvironmentVariables: project.sandboxEnvironmentVariables ?? [],
    };
  },
});

export const upsertSandboxEnvironmentVariablesInternal = internalMutation({
  args: {
    authorId: v.string(),
    projectId: v.string(),
    variables: v.array(sandboxEnvironmentVariableValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== args.authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const updatedNames = new Set(args.variables.map((variable) => variable.envName));
    const sandboxEnvironmentVariables = (project.sandboxEnvironmentVariables ?? []).filter(
      (variable) => !updatedNames.has(variable.envName),
    );
    sandboxEnvironmentVariables.push(...args.variables);
    sandboxEnvironmentVariables.sort((left, right) => left.envName.localeCompare(right.envName));

    await ctx.db.patch(project._id, {
      sandboxEnvironmentVariables,
      sandboxSecrets: (project.sandboxSecrets ?? []).filter(
        (secret) => !updatedNames.has(secret.envName),
      ),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const upsertSandboxSecretsInternal = internalMutation({
  args: {
    authorId: v.string(),
    projectId: v.string(),
    secrets: v.array(sandboxSecretValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();
    if (!project || project.authorId !== args.authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }
    const updatedNames = new Set(args.secrets.map((secret) => secret.envName));
    const sandboxSecrets = (project.sandboxSecrets ?? []).filter(
      (secret) => !updatedNames.has(secret.envName),
    );
    sandboxSecrets.push(...args.secrets);
    sandboxSecrets.sort((left, right) => left.envName.localeCompare(right.envName));
    await ctx.db.patch(project._id, {
      sandboxSecrets,
      sandboxEnvironmentVariables: (project.sandboxEnvironmentVariables ?? []).filter(
        (variable) => !updatedNames.has(variable.envName),
      ),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const removeSandboxEnvironmentVariableInternal = internalMutation({
  args: {
    authorId: v.string(),
    projectId: v.string(),
    envName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== args.authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    await ctx.db.patch(project._id, {
      sandboxSecrets: (project.sandboxSecrets ?? []).filter(
        (secret) => secret.envName !== args.envName,
      ),
      sandboxEnvironmentVariables: (project.sandboxEnvironmentVariables ?? []).filter(
        (variable) => variable.envName !== args.envName,
      ),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const getForRemovalInternal = internalQuery({
  args: {
    authorId: v.string(),
    projectId: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== args.authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    return {
      projectId: project.projectId,
      sandboxId: project.sandboxId,
      sandboxName: project.sandboxName,
      sandboxProvider: resolvedSandboxProvider(project.sandboxProvider),
      repoFullName: project.repoFullName,
      createdAt: project.createdAt,
      sandboxSecrets: project.sandboxSecrets ?? [],
    };
  },
});

export const removeInternal = internalMutation({
  args: {
    authorId: v.string(),
    projectId: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== args.authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const [messages, threads] = await Promise.all([
      ctx.db
        .query("messages")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect(),
      ctx.db
        .query("threads")
        .withIndex("by_author_project", (q) => q.eq("authorId", args.authorId).eq("projectId", args.projectId))
        .collect(),
    ]);

    await deleteAssistantPartsBlobKeys(
      ctx as unknown as AssistantPartsBlobDeleteCtx,
      collectAssistantPartsBlobKeys(messages),
    );
    await Promise.all([
      ...messages.map((message) => ctx.db.delete(message._id)),
      ...threads.map((thread) => ctx.db.delete(thread._id)),
      ctx.db.delete(project._id),
    ]);

    return null;
  },
});

export const remove = mutation({
  args: {
    projectId: v.string(),
  },
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const [messages, threads] = await Promise.all([
      ctx.db
        .query("messages")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect(),
      ctx.db
        .query("threads")
        .withIndex("by_author_project", (q) => q.eq("authorId", authorId).eq("projectId", args.projectId))
        .collect(),
    ]);

    await deleteAssistantPartsBlobKeys(
      ctx as unknown as AssistantPartsBlobDeleteCtx,
      collectAssistantPartsBlobKeys(messages),
    );
    await Promise.all([
      ...messages.map((message) => ctx.db.delete(message._id)),
      ...threads.map((thread) => ctx.db.delete(thread._id)),
      ctx.db.delete(project._id),
    ]);

    return null;
  },
});
