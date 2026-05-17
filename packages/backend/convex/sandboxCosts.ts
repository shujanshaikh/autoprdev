import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireUserId } from "./lib/auth";

const ACTIVE_SYNC_INTERVAL_MS = 5 * 60_000;
const FINALIZATION_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const FINALIZATION_WINDOW_MS = 24 * 60 * 60_000;
const shortError = (message: string) => message.slice(0, 700);

function requireDaytonaOrganizationId() {
  const value = process.env.DAYTONA_ORGANIZATION_ID;
  if (!value) {
    throw new ConvexError({
      code: "DAYTONA_ANALYTICS_CONFIG_MISSING",
      message: "DAYTONA_ORGANIZATION_ID is required for sandbox cost tracking.",
    });
  }
  return value;
}

function nextFinalizationDelay(attempts: number) {
  return FINALIZATION_DELAYS_MS[Math.min(attempts, FINALIZATION_DELAYS_MS.length - 1)] ?? 60 * 60_000;
}

export const upsertWhenSandboxReadyInternal = internalMutation({
  args: {
    authorId: v.string(),
    projectId: v.string(),
    sandboxId: v.string(),
    sandboxName: v.optional(v.string()),
    repoFullName: v.optional(v.string()),
    sandboxCreatedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const daytonaOrganizationId = requireDaytonaOrganizationId();
    const existing = await ctx.db
      .query("sandboxCosts")
      .withIndex("by_sandbox_id", (q) => q.eq("sandboxId", args.sandboxId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        authorId: args.authorId,
        projectId: args.projectId,
        sandboxName: args.sandboxName,
        repoFullName: args.repoFullName,
        daytonaOrganizationId,
        status: "active",
        deletedAt: undefined,
        finalizedAt: undefined,
        syncError: undefined,
        nextSyncAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("sandboxCosts", {
        authorId: args.authorId,
        projectId: args.projectId,
        sandboxId: args.sandboxId,
        sandboxName: args.sandboxName,
        repoFullName: args.repoFullName,
        daytonaOrganizationId,
        status: "active",
        sandboxCreatedAt: args.sandboxCreatedAt,
        finalizationAttempts: 0,
        nextSyncAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.scheduler.runAfter(0, internal.sandboxCostActions.syncOneSandboxCost, {
      sandboxId: args.sandboxId,
      finalize: false,
    });
    return null;
  },
});

export const getBySandboxIdInternal = internalQuery({
  args: { sandboxId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("sandboxCosts")
      .withIndex("by_sandbox_id", (q) => q.eq("sandboxId", args.sandboxId))
      .unique(),
});

export const listDueInternal = internalQuery({
  args: { now: v.number(), status: v.union(v.literal("active"), v.literal("pending_finalization")) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("sandboxCosts")
      .withIndex("by_next_sync", (q) => q.lte("nextSyncAt", args.now))
      .collect();
    return rows.filter((row) => row.status === args.status);
  },
});

export const recordSyncSuccessInternal = internalMutation({
  args: {
    sandboxId: v.string(),
    totalPrice: v.number(),
    finalize: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("sandboxCosts")
      .withIndex("by_sandbox_id", (q) => q.eq("sandboxId", args.sandboxId))
      .unique();
    if (!row) return null;
    const now = Date.now();
    await ctx.db.patch(row._id, args.finalize
      ? {
          latestTotalPrice: args.totalPrice,
          finalTotalPrice: args.totalPrice,
          status: "finalized",
          lastSyncedAt: now,
          finalizedAt: now,
          syncError: undefined,
          nextSyncAt: undefined,
          updatedAt: now,
        }
      : {
          latestTotalPrice: args.totalPrice,
          lastSyncedAt: now,
          syncError: undefined,
          nextSyncAt: now + ACTIVE_SYNC_INTERVAL_MS,
          updatedAt: now,
        });
    return null;
  },
});

export const recordSyncFailureInternal = internalMutation({
  args: {
    sandboxId: v.string(),
    error: v.string(),
    finalize: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("sandboxCosts")
      .withIndex("by_sandbox_id", (q) => q.eq("sandboxId", args.sandboxId))
      .unique();
    if (!row) return null;
    const now = Date.now();
    const attempts = args.finalize ? row.finalizationAttempts + 1 : row.finalizationAttempts;
    const nextSyncAt = args.finalize
      ? row.deletedAt && now - row.deletedAt < FINALIZATION_WINDOW_MS
        ? now + nextFinalizationDelay(row.finalizationAttempts)
        : undefined
      : now + ACTIVE_SYNC_INTERVAL_MS;
    await ctx.db.patch(row._id, {
      syncError: shortError(args.error),
      finalizationAttempts: attempts,
      nextSyncAt,
      updatedAt: now,
    });
    return null;
  },
});

export const markPendingFinalizationInternal = internalMutation({
  args: {
    authorId: v.string(),
    projectId: v.string(),
    sandboxId: v.string(),
    sandboxName: v.optional(v.string()),
    repoFullName: v.optional(v.string()),
    sandboxCreatedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("sandboxCosts")
      .withIndex("by_sandbox_id", (q) => q.eq("sandboxId", args.sandboxId))
      .unique();
    const now = Date.now();
    if (!row) {
      await ctx.db.insert("sandboxCosts", {
        authorId: args.authorId,
        projectId: args.projectId,
        sandboxId: args.sandboxId,
        sandboxName: args.sandboxName,
        repoFullName: args.repoFullName,
        daytonaOrganizationId: requireDaytonaOrganizationId(),
        status: "pending_finalization",
        sandboxCreatedAt: args.sandboxCreatedAt,
        deletedAt: now,
        finalizationAttempts: 0,
        nextSyncAt: now + FINALIZATION_DELAYS_MS[0],
        createdAt: now,
        updatedAt: now,
      });
      return null;
    }
    await ctx.db.patch(row._id, {
      status: "pending_finalization",
      deletedAt: row.deletedAt ?? now,
      nextSyncAt: now + FINALIZATION_DELAYS_MS[0],
      updatedAt: now,
    });
    return null;
  },
});

export const listForCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const authorId = await requireUserId(ctx);
    return await ctx.db
      .query("sandboxCosts")
      .withIndex("by_author", (q) => q.eq("authorId", authorId))
      .order("desc")
      .collect();
  },
});

export const summaryForCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const authorId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("sandboxCosts")
      .withIndex("by_author", (q) => q.eq("authorId", authorId))
      .collect();
    return {
      totalKnownCost: rows.reduce((sum, row) => sum + (row.finalTotalPrice ?? row.latestTotalPrice ?? 0), 0),
      activeKnownCost: rows
        .filter((row) => row.status === "active")
        .reduce((sum, row) => sum + (row.latestTotalPrice ?? 0), 0),
      pendingCount: rows.filter((row) => row.status === "pending_finalization").length,
      finalizedCount: rows.filter((row) => row.status === "finalized").length,
    };
  },
});
