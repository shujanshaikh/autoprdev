import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireUserId } from "./lib/auth";

export const status = query({
  args: {},
  handler: async (ctx) => {
    const authorId = await requireUserId(ctx);
    const record = await ctx.db
      .query("codexCredentials")
      .withIndex("by_author", (q) => q.eq("authorId", authorId))
      .unique();

    if (!record) {
      return { connected: false as const };
    }

    return {
      connected: true as const,
      connectedAt: record.connectedAt,
      updatedAt: record.updatedAt,
      accountId: record.accountId,
      email: record.email,
      expiresAt: record.expiresAt,
    };
  },
});

export const upsert = mutation({
  args: {
    organizationId: v.string(),
    vaultObjectId: v.string(),
    vaultVersionId: v.optional(v.string()),
    accountId: v.optional(v.string()),
    email: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("codexCredentials")
      .withIndex("by_author", (q) => q.eq("authorId", authorId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        organizationId: args.organizationId,
        vaultObjectId: args.vaultObjectId,
        vaultVersionId: args.vaultVersionId,
        accountId: args.accountId,
        email: args.email,
        expiresAt: args.expiresAt,
        updatedAt: now,
      });
      return;
    }

    await ctx.db.insert("codexCredentials", {
      authorId,
      organizationId: args.organizationId,
      vaultObjectId: args.vaultObjectId,
      vaultVersionId: args.vaultVersionId,
      accountId: args.accountId,
      email: args.email,
      expiresAt: args.expiresAt,
      connectedAt: now,
      updatedAt: now,
    });
  },
});

export const getVaultReference = query({
  args: {},
  handler: async (ctx) => {
    const authorId = await requireUserId(ctx);
    const record = await ctx.db
      .query("codexCredentials")
      .withIndex("by_author", (q) => q.eq("authorId", authorId))
      .unique();

    if (!record) {
      throw new ConvexError({ code: "CODEX_NOT_CONNECTED" });
    }

    return {
      organizationId: record.organizationId,
      vaultObjectId: record.vaultObjectId,
      vaultVersionId: record.vaultVersionId,
    };
  },
});

export const remove = mutation({
  args: {},
  handler: async (ctx) => {
    const authorId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("codexCredentials")
      .withIndex("by_author", (q) => q.eq("authorId", authorId))
      .unique();

    if (!existing) {
      return undefined;
    }

    await ctx.db.delete(existing._id);
    return {
      organizationId: existing.organizationId,
      vaultObjectId: existing.vaultObjectId,
    };
  },
});
