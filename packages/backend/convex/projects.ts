import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireUserId } from "./lib/auth";
import { randomUuid } from "./lib/uuid";

const shortError = (message: string) => message.slice(0, 700);
const sandboxStatusValidator = v.union(v.literal("creating"), v.literal("ready"), v.literal("failed"));
const sandboxRuntimeStatusValidator = v.union(
  v.literal("started"),
  v.literal("stopped"),
  v.literal("archived"),
  v.literal("unknown"),
);
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
      sandboxStatus: "creating",
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    });

    return {
      projectId,
      created: true,
      sandboxStatus: "creating" as const,
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
  },
  returns: v.object({
    projectId: v.string(),
    created: v.boolean(),
    sandboxStatus: sandboxStatusValidator,
    sandboxId: v.optional(v.string()),
    sandboxWorkDir: v.optional(v.string()),
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
      sandboxStatus: "creating",
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    });

    return {
      projectId,
      created: true,
      sandboxStatus: "creating" as const,
    };
  },
});

export const markSandboxReadyInternal = internalMutation({
  args: {
    authorId: v.string(),
    projectId: v.string(),
    sandboxId: v.string(),
    sandboxName: v.optional(v.string()),
    sandboxSnapshot: v.optional(v.string()),
    sandboxWorkDir: v.optional(v.string()),
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
      sandboxCreatedAt: project.createdAt,
    });

    return null;
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

export const markSandboxReady = mutation({
  args: {
    projectId: v.string(),
    sandboxId: v.string(),
    sandboxName: v.optional(v.string()),
    sandboxSnapshot: v.optional(v.string()),
    sandboxWorkDir: v.optional(v.string()),
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
      sandboxId: args.sandboxId,
      sandboxName: args.sandboxName,
      sandboxSnapshot: args.sandboxSnapshot,
      sandboxWorkDir: args.sandboxWorkDir,
      sandboxStatus: "ready",
      sandboxRuntimeStatus: "started",
      sandboxRuntimeCheckedAt: Date.now(),
      sandboxError: undefined,
      branchSwitchStatus: "idle",
      updatedAt: Date.now(),
    });
    await ctx.runMutation(internal.sandboxCosts.upsertWhenSandboxReadyInternal, {
      authorId,
      projectId: args.projectId,
      sandboxId: args.sandboxId,
      sandboxName: args.sandboxName,
      repoFullName: project.repoFullName,
      sandboxCreatedAt: project.createdAt,
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
      sandboxRuntimeStatus: project.sandboxRuntimeStatus,
      sandboxRuntimeCheckedAt: project.sandboxRuntimeCheckedAt,
    };
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
      repoFullName: project.repoFullName,
      createdAt: project.createdAt,
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

    await Promise.all([
      ...messages.map((message) => ctx.db.delete(message._id)),
      ...threads.map((thread) => ctx.db.delete(thread._id)),
      ctx.db.delete(project._id),
    ]);

    return null;
  },
});
