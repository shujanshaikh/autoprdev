import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireUserId } from "./lib/auth";

async function requireOwnedThread(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"threads">,
  authorId: string,
) {
  const thread = await ctx.db.get(threadId);

  if (!thread || thread.authorId !== authorId) {
    throw new ConvexError({ code: "UNAUTHORIZED" });
  }

  const project = await ctx.db.get(thread.projectId);

  if (!project || project.authorId !== authorId) {
    throw new ConvexError({ code: "UNAUTHORIZED" });
  }

  return { thread, project };
}

export const listByThread = query({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.authorId !== identity.subject) {
      return [];
    }

    const project = await ctx.db.get(thread.projectId);
    if (!project || project.authorId !== identity.subject) {
      return [];
    }

    return await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .collect();
  },
});

export const createTurn = mutation({
  args: {
    projectId: v.id("projects"),
    threadId: v.id("threads"),
    userMessage: v.object({
      messageId: v.string(),
      parts: v.array(v.any()),
      metadata: v.optional(v.any()),
    }),
    assistantMessageId: v.string(),
  },
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const { thread } = await requireOwnedThread(ctx, args.threadId, authorId);

    if (thread.projectId !== args.projectId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const existingAssistant = await ctx.db
      .query("messages")
      .withIndex("by_message_id", (q) => q.eq("messageId", args.assistantMessageId))
      .first();

    if (existingAssistant && existingAssistant.threadId === args.threadId) {
      return existingAssistant.messageId;
    }

    const now = Date.now();
    await ctx.db.insert("messages", {
      threadId: args.threadId,
      projectId: args.projectId,
      authorId,
      messageId: args.userMessage.messageId,
      role: "user",
      parts: args.userMessage.parts,
      metadata: args.userMessage.metadata,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("messages", {
      threadId: args.threadId,
      projectId: args.projectId,
      authorId,
      messageId: args.assistantMessageId,
      role: "assistant",
      parts: [],
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.threadId, {
      updatedAt: now,
    });

    return args.assistantMessageId;
  },
});

export const patchAssistant = mutation({
  args: {
    threadId: v.id("threads"),
    assistantMessageId: v.string(),
    parts: v.array(v.any()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const { thread } = await requireOwnedThread(ctx, args.threadId, authorId);
    const assistant = await ctx.db
      .query("messages")
      .withIndex("by_message_id", (q) => q.eq("messageId", args.assistantMessageId))
      .first();

    if (!assistant || assistant.threadId !== args.threadId || assistant.role !== "assistant") {
      throw new ConvexError({ code: "NOT_FOUND" });
    }

    const now = Date.now();
    await ctx.db.patch(assistant._id, {
      parts: args.parts,
      metadata: args.metadata,
      updatedAt: now,
    });

    await ctx.db.patch(thread._id, {
      updatedAt: now,
    });

    return null;
  },
});
