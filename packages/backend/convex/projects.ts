import { ConvexError, v } from "convex/values";

import { internalMutation, mutation, query } from "./_generated/server";
import { requireUserId } from "./lib/auth";
import { randomUuid } from "./lib/uuid";

const shortError = (message: string) => message.slice(0, 700);
const sandboxStatusValidator = v.union(v.literal("creating"), v.literal("ready"), v.literal("failed"));
type SandboxStatus = "creating" | "ready" | "failed";

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
      sandboxError: undefined,
      updatedAt: Date.now(),
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

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    return await ctx.db
      .query("projects")
      .withIndex("by_author", (q) => q.eq("authorId", identity.subject))
      .order("desc")
      .collect();
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
