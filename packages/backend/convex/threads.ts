import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireUserId } from "./lib/auth";

async function getOwnedProject(ctx: QueryCtx | MutationCtx, projectId: Id<"projects">, authorId: string) {
  const project = await ctx.db.get(projectId);

  if (!project || project.authorId !== authorId) {
    throw new ConvexError({ code: "UNAUTHORIZED" });
  }

  return project;
}

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const project = await ctx.db.get(args.projectId);

    if (!project || project.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    if (project.sandboxStatus !== "ready") {
      throw new ConvexError({ code: "PROJECT_NOT_READY" });
    }

    const now = Date.now();
    return await ctx.db.insert("threads", {
      projectId: args.projectId,
      authorId,
      title: args.title?.trim() || "New thread",
      createdAt: now,
      updatedAt: now,
      isLive: false,
    });
  },
});

export const listByProject = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const project = await ctx.db.get(args.projectId);
    if (!project || project.authorId !== identity.subject) {
      return [];
    }

    return await ctx.db
      .query("threads")
      .withIndex("by_author_project", (q) => q.eq("authorId", identity.subject).eq("projectId", args.projectId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const thread = await ctx.db.get(args.threadId);

    if (!thread || thread.authorId !== identity.subject) {
      return null;
    }

    return thread;
  },
});

export const markRunStarted = mutation({
  args: {
    threadId: v.id("threads"),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const thread = await ctx.db.get(args.threadId);

    if (!thread || thread.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    await ctx.db.patch(args.threadId, {
      currentRunId: args.runId,
      isLive: true,
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const markRunFinished = mutation({
  args: {
    threadId: v.id("threads"),
    runId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const thread = await ctx.db.get(args.threadId);

    if (!thread || thread.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    if (args.runId && thread.currentRunId && thread.currentRunId !== args.runId) {
      return null;
    }

    await ctx.db.patch(args.threadId, {
      currentRunId: undefined,
      isLive: false,
      updatedAt: Date.now(),
    });

    return null;
  },
});
