import { ConvexError, v } from "convex/values";
import type { UIMessage } from "ai";

import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { IMAGE_URL_EXPIRES_IN_SECONDS, r2 } from "./imageUploads";
import { requireUserId } from "./lib/auth";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requireOwnedThread(
  ctx: QueryCtx | MutationCtx,
  threadId: string,
  authorId: string,
) {
  const thread = await ctx.db
    .query("threads")
    .withIndex("by_thread_id", (q) => q.eq("threadId", threadId))
    .unique();

  if (!thread || thread.authorId !== authorId) {
    throw new ConvexError({ code: "UNAUTHORIZED" });
  }

  const project = await ctx.db
    .query("projects")
    .withIndex("by_project_id", (q) => q.eq("projectId", thread.projectId))
    .unique();

  if (!project || project.authorId !== authorId) {
    throw new ConvexError({ code: "UNAUTHORIZED" });
  }

  return { thread, project };
}

function getR2Key(part: UIMessage["parts"][number]) {
  if (part.type !== "file" || !isRecord(part.providerMetadata)) {
    return null;
  }

  const autoprMetadata = part.providerMetadata.autopr;

  return isRecord(autoprMetadata) && typeof autoprMetadata.r2Key === "string"
    ? autoprMetadata.r2Key
    : null;
}

async function getOwnedR2Url(ctx: QueryCtx, authorId: string, key: string) {
  const upload = await ctx.db
    .query("uploadedImages")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();

  if (!upload || upload.authorId !== authorId) {
    return null;
  }

  return await r2.getUrl(key, {
    expiresIn: IMAGE_URL_EXPIRES_IN_SECONDS,
  });
}

async function refreshR2FilePartUrls(
  ctx: QueryCtx,
  authorId: string,
  parts: UIMessage["parts"],
): Promise<UIMessage["parts"]> {
  return await Promise.all(parts.map(async (part) => {
    const key = getR2Key(part);

    if (!key || part.type !== "file") {
      return part;
    }

    const url = await getOwnedR2Url(ctx, authorId, key);

    return url ? { ...part, url } : part;
  }));
}

export const listByThread = query({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const thread = await ctx.db
      .query("threads")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!thread || thread.authorId !== identity.subject) {
      return [];
    }

    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", thread.projectId))
      .unique();

    if (!project || project.authorId !== identity.subject) {
      return [];
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .collect();

    return await Promise.all(messages.map(async (message) => ({
      ...message,
      parts: await refreshR2FilePartUrls(ctx, identity.subject, message.parts),
    })));
  },
});

export const createTurn = mutation({
  args: {
    projectId: v.string(),
    threadId: v.string(),
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

    const threadMessages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .collect();

    const existingUser = threadMessages.find(
      (message) => message.role === "user" && message.messageId === args.userMessage.messageId,
    );

    if (existingUser) {
      const existingAssistant = threadMessages.find(
        (message) => message.role === "assistant" && message.createdAt >= existingUser.createdAt,
      );

      if (existingAssistant) {
        return existingAssistant.messageId;
      }
    }

    const existingAssistant = threadMessages.find(
      (message) => message.role === "assistant" && message.messageId === args.assistantMessageId,
    );

    if (existingAssistant) {
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

    await ctx.db.patch(thread._id, {
      updatedAt: now,
    });

    return args.assistantMessageId;
  },
});

export const patchAssistant = mutation({
  args: {
    threadId: v.string(),
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
