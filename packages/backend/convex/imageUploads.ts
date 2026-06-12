import { R2 } from "@convex-dev/r2";
import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireUserId } from "./lib/auth";

export const IMAGE_URL_EXPIRES_IN_SECONDS = 60 * 60;

export const r2 = new R2(components.r2);

async function requireCallbackUserId(ctx: Pick<QueryCtx | MutationCtx, "auth">) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new ConvexError({ code: "UNAUTHORIZED" });
  }

  return identity.subject;
}

export const { generateUploadUrl, syncMetadata } = r2.clientApi<DataModel>({
  checkUpload: async (ctx) => {
    await requireCallbackUserId(ctx);
  },
  onUpload: async (ctx, bucket, key) => {
    const authorId = await requireCallbackUserId(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("uploadedImages")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();

    if (existing) {
      if (existing.authorId !== authorId) {
        throw new ConvexError({ code: "UNAUTHORIZED" });
      }

      await ctx.db.patch(existing._id, {
        bucket,
        updatedAt: now,
      });
      return;
    }

    await ctx.db.insert("uploadedImages", {
      authorId,
      key,
      bucket,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getUrl = query({
  args: {
    key: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const upload = await ctx.db
      .query("uploadedImages")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (!upload || upload.authorId !== authorId) {
      throw new ConvexError({ code: "NOT_FOUND" });
    }

    return await r2.getUrl(args.key, {
      expiresIn: IMAGE_URL_EXPIRES_IN_SECONDS,
    });
  },
});
