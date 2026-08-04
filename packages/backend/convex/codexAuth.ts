import { ConvexError, v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";

export const status = internalQuery({
  args: { authorId: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("codexCredentials")
      .withIndex("by_author", (q) => q.eq("authorId", args.authorId))
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

export const getConnection = internalQuery({
  args: { authorId: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("codexCredentials")
      .withIndex("by_author", (q) => q.eq("authorId", args.authorId))
      .unique();

    if (!record) {
      return undefined;
    }

    return {
      vaultObjectId: record.vaultObjectId,
      vaultVersionId: record.vaultVersionId,
      accountId: record.accountId,
      email: record.email,
      expiresAt: record.expiresAt,
    };
  },
});

export const upsert = internalMutation({
  args: {
    authorId: v.string(),
    vaultObjectId: v.string(),
    vaultVersionId: v.optional(v.string()),
    accountId: v.optional(v.string()),
    email: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("codexCredentials")
      .withIndex("by_author", (q) => q.eq("authorId", args.authorId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
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
      authorId: args.authorId,
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

export const getVaultReference = internalQuery({
  args: { authorId: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("codexCredentials")
      .withIndex("by_author", (q) => q.eq("authorId", args.authorId))
      .unique();

    if (!record) {
      throw new ConvexError({ code: "CODEX_NOT_CONNECTED" });
    }

    return {
      vaultObjectId: record.vaultObjectId,
      vaultVersionId: record.vaultVersionId,
    };
  },
});

export const remove = internalMutation({
  args: { authorId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("codexCredentials")
      .withIndex("by_author", (q) => q.eq("authorId", args.authorId))
      .unique();

    if (!existing) {
      return undefined;
    }

    await ctx.db.delete(existing._id);
    return {
      vaultObjectId: existing.vaultObjectId,
    };
  },
});
