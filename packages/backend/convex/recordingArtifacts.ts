import { ConvexError, v } from "convex/values";

import { internalMutation, internalQuery, query } from "./_generated/server";
import { IMAGE_URL_EXPIRES_IN_SECONDS, r2 } from "./imageUploads";
import { requireUserId } from "./lib/auth";

const MAX_ERROR_LENGTH = 700;

const uploadStatusValidator = v.union(
  v.literal("uploading"),
  v.literal("uploaded"),
  v.literal("failed"),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const getPlaybackUrl = query({
  args: {
    projectId: v.string(),
    threadId: v.string(),
    recordingId: v.string(),
  },
  returns: v.union(
    v.object({
      status: uploadStatusValidator,
      url: v.optional(v.string()),
      error: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!thread || thread.authorId !== authorId || thread.projectId !== args.projectId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const artifact = await ctx.db
      .query("recordingArtifacts")
      .withIndex("by_thread_recording", (q) => q.eq("threadId", args.threadId).eq("recordingId", args.recordingId))
      .first();

    if (!artifact || artifact.authorId !== authorId || artifact.projectId !== args.projectId) {
      return null;
    }

    return {
      status: artifact.status,
      url: artifact.status === "uploaded" && artifact.r2Key
        ? await r2.getUrl(artifact.r2Key, { expiresIn: IMAGE_URL_EXPIRES_IN_SECONDS })
        : undefined,
      error: artifact.error,
    };
  },
});

export const getForUploadInternal = internalQuery({
  args: {
    authorId: v.string(),
    projectId: v.string(),
    threadId: v.string(),
    recordingId: v.string(),
  },
  returns: v.union(
    v.object({
      status: uploadStatusValidator,
      r2Key: v.optional(v.string()),
      error: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!thread || thread.authorId !== args.authorId || thread.projectId !== args.projectId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== args.authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const artifact = await ctx.db
      .query("recordingArtifacts")
      .withIndex("by_thread_recording", (q) => q.eq("threadId", args.threadId).eq("recordingId", args.recordingId))
      .first();

    if (!artifact) {
      return null;
    }

    if (artifact.authorId !== args.authorId || artifact.projectId !== args.projectId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    return {
      status: artifact.status,
      r2Key: artifact.r2Key,
      error: artifact.error,
    };
  },
});

export const markUploadingInternal = internalMutation({
  args: {
    authorId: v.string(),
    projectId: v.string(),
    threadId: v.string(),
    recordingId: v.string(),
    r2Key: v.string(),
    sourceFileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
  },
  returns: v.object({
    r2Key: v.string(),
    status: uploadStatusValidator,
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("recordingArtifacts")
      .withIndex("by_thread_recording", (q) => q.eq("threadId", args.threadId).eq("recordingId", args.recordingId))
      .first();

    if (existing) {
      if (existing.authorId !== args.authorId || existing.projectId !== args.projectId) {
        throw new ConvexError({ code: "UNAUTHORIZED" });
      }

      if (existing.status === "uploaded" && existing.r2Key) {
        return { r2Key: existing.r2Key, status: "uploaded" as const };
      }

      await ctx.db.patch(existing._id, {
        r2Key: existing.r2Key ?? args.r2Key,
        sourceFileName: args.sourceFileName ?? existing.sourceFileName,
        contentType: args.contentType ?? existing.contentType,
        sizeBytes: args.sizeBytes ?? existing.sizeBytes,
        durationSeconds: args.durationSeconds ?? existing.durationSeconds,
        status: "uploading",
        error: undefined,
        updatedAt: now,
      });

      return { r2Key: existing.r2Key ?? args.r2Key, status: "uploading" as const };
    }

    await ctx.db.insert("recordingArtifacts", {
      authorId: args.authorId,
      projectId: args.projectId,
      threadId: args.threadId,
      recordingId: args.recordingId,
      r2Key: args.r2Key,
      sourceFileName: args.sourceFileName,
      contentType: args.contentType,
      sizeBytes: args.sizeBytes,
      durationSeconds: args.durationSeconds,
      status: "uploading",
      createdAt: now,
      updatedAt: now,
    });

    return { r2Key: args.r2Key, status: "uploading" as const };
  },
});

export const markUploadedInternal = internalMutation({
  args: {
    authorId: v.string(),
    projectId: v.string(),
    threadId: v.string(),
    recordingId: v.string(),
    r2Key: v.string(),
    sourceFileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const artifact = await ctx.db
      .query("recordingArtifacts")
      .withIndex("by_thread_recording", (q) => q.eq("threadId", args.threadId).eq("recordingId", args.recordingId))
      .first();

    if (!artifact || artifact.authorId !== args.authorId || artifact.projectId !== args.projectId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const now = Date.now();
    await ctx.db.patch(artifact._id, {
      r2Key: args.r2Key,
      sourceFileName: args.sourceFileName ?? artifact.sourceFileName,
      contentType: args.contentType ?? artifact.contentType,
      sizeBytes: args.sizeBytes ?? artifact.sizeBytes,
      durationSeconds: args.durationSeconds ?? artifact.durationSeconds,
      status: "uploaded",
      error: undefined,
      uploadedAt: now,
      updatedAt: now,
    });

    return null;
  },
});

export const markFailedInternal = internalMutation({
  args: {
    authorId: v.string(),
    projectId: v.string(),
    threadId: v.string(),
    recordingId: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const artifact = await ctx.db
      .query("recordingArtifacts")
      .withIndex("by_thread_recording", (q) => q.eq("threadId", args.threadId).eq("recordingId", args.recordingId))
      .first();

    if (!artifact || artifact.authorId !== args.authorId || artifact.projectId !== args.projectId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    await ctx.db.patch(artifact._id, {
      status: "failed",
      error: args.error.slice(0, MAX_ERROR_LENGTH),
      updatedAt: Date.now(),
    });

    return null;
  },
});
