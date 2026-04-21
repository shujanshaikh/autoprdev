import { ConvexError, v } from "convex/values";

import { internalMutation, query } from "./_generated/server";
import { requireUserId } from "./lib/auth";

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
    projectId: v.id("projects"),
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
        projectId: existing._id,
        created: false,
        sandboxStatus: existing.sandboxStatus as SandboxStatus,
      };
    }

    const projectId = await ctx.db.insert("projects", {
      authorId: args.authorId,
      githubUrl: args.githubUrl,
      cloneUrl: args.cloneUrl,
      repoFullName: args.repoFullName,
      repoOwner: args.repoOwner,
      repoName: args.repoName,
      repoBranch: args.repoBranch,
      sandboxCacheKey: "",
      sandboxStatus: "creating",
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    });

    await ctx.db.patch(projectId, {
      sandboxCacheKey: projectId,
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
    projectId: v.id("projects"),
    sandboxId: v.string(),
    sandboxName: v.optional(v.string()),
    sandboxSnapshot: v.optional(v.string()),
    sandboxWorkDir: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);

    if (!project || project.authorId !== args.authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    await ctx.db.patch(args.projectId, {
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
    projectId: v.id("projects"),
    sandboxError: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);

    if (!project || project.authorId !== args.authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    await ctx.db.patch(args.projectId, {
      sandboxStatus: "failed",
      sandboxError: shortError(args.sandboxError),
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const get = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const project = await ctx.db.get(args.projectId);

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
