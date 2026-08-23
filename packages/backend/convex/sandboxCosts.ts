import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireUserId } from "./lib/auth";
import { estimatedE2BPrice } from "./lib/e2bPricing";
import {
  resolvedSandboxProvider,
  sandboxProviderValidator,
} from "./lib/sandboxProvider";

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
    sandboxProvider: sandboxProviderValidator,
    e2bCpuCount: v.optional(v.number()),
    e2bMemoryMB: v.optional(v.number()),
    sandboxCreatedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const daytonaOrganizationId = args.sandboxProvider === "daytona"
      ? requireDaytonaOrganizationId()
      : undefined;
    const existing = await ctx.db
      .query("sandboxCosts")
      .withIndex("by_sandbox_id", (q) => q.eq("sandboxId", args.sandboxId))
      .unique();

    if (existing) {
      const e2bRunningMs = args.sandboxProvider === "e2b"
        ? (existing.e2bRunningMs ?? 0) + (
            existing.e2bMeteringStartedAt === undefined
              ? 0
              : Math.max(0, now - existing.e2bMeteringStartedAt)
          )
        : undefined;
      await ctx.db.patch(existing._id, {
        authorId: args.authorId,
        projectId: args.projectId,
        sandboxName: args.sandboxName,
        repoFullName: args.repoFullName,
        sandboxProvider: args.sandboxProvider,
        daytonaOrganizationId,
        costSource: args.sandboxProvider === "e2b" ? "estimated" : "authoritative",
        e2bCpuCount: args.e2bCpuCount,
        e2bMemoryMB: args.e2bMemoryMB,
        e2bRunningMs,
        e2bMeteringStartedAt: args.sandboxProvider === "e2b" ? now : undefined,
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
        sandboxProvider: args.sandboxProvider,
        daytonaOrganizationId,
        costSource: args.sandboxProvider === "e2b" ? "estimated" : "authoritative",
        e2bCpuCount: args.e2bCpuCount,
        e2bMemoryMB: args.e2bMemoryMB,
        e2bRunningMs: args.sandboxProvider === "e2b" ? 0 : undefined,
        e2bMeteringStartedAt: args.sandboxProvider === "e2b" ? now : undefined,
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
    if (row.status === "finalized" || (args.finalize && row.status !== "pending_finalization")) return null;
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

export const recordE2BSyncSuccessInternal = internalMutation({
  args: {
    sandboxId: v.string(),
    meteredUntil: v.number(),
    startedAt: v.number(),
    running: v.boolean(),
    cpuCount: v.number(),
    memoryMB: v.number(),
    finalize: v.boolean(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("sandboxCosts")
      .withIndex("by_sandbox_id", (q) => q.eq("sandboxId", args.sandboxId))
      .unique();
    if (!row) return false;
    const expectedStatus = args.finalize ? "pending_finalization" : "active";
    if (row.status !== expectedStatus) return false;
    if (row.lastSyncedAt !== undefined && args.meteredUntil < row.lastSyncedAt) return false;
    const now = Date.now();
    const startedAt = row.e2bMeteringStartedAt ?? (
      args.running
        ? Math.max(args.startedAt, row.lastSyncedAt ?? args.startedAt)
        : undefined
    );
    const additionalMs = startedAt === undefined
      ? 0
      : Math.max(0, args.meteredUntil - startedAt);
    const runningMs = (row.e2bRunningMs ?? 0) + additionalMs;
    const totalPrice = estimatedE2BPrice(runningMs, args.cpuCount, args.memoryMB);
    await ctx.db.patch(row._id, {
      sandboxProvider: "e2b",
      costSource: "estimated",
      e2bCpuCount: args.cpuCount,
      e2bMemoryMB: args.memoryMB,
      e2bRunningMs: runningMs,
      e2bMeteringStartedAt: !args.finalize && args.running ? args.meteredUntil : undefined,
      latestTotalPrice: totalPrice,
      finalTotalPrice: args.finalize ? totalPrice : undefined,
      status: args.finalize ? "finalized" : row.status,
      lastSyncedAt: now,
      finalizedAt: args.finalize ? now : undefined,
      syncError: undefined,
      nextSyncAt: args.finalize ? undefined : now + ACTIVE_SYNC_INTERVAL_MS,
      updatedAt: now,
    });
    return true;
  },
});

export const startE2BMeteringInternal = internalMutation({
  args: { sandboxId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("sandboxCosts")
      .withIndex("by_sandbox_id", (q) => q.eq("sandboxId", args.sandboxId))
      .unique();
    if (!row || resolvedSandboxProvider(row.sandboxProvider) !== "e2b") return null;
    if (row.e2bMeteringStartedAt === undefined) {
      await ctx.db.patch(row._id, { e2bMeteringStartedAt: Date.now(), updatedAt: Date.now() });
    }
    return null;
  },
});

export const stopE2BMeteringInternal = internalMutation({
  args: { sandboxId: v.string(), stoppedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("sandboxCosts")
      .withIndex("by_sandbox_id", (q) => q.eq("sandboxId", args.sandboxId))
      .unique();
    if (!row || resolvedSandboxProvider(row.sandboxProvider) !== "e2b") return null;
    const runningMs = (row.e2bRunningMs ?? 0) + (
      row.e2bMeteringStartedAt === undefined ? 0 : Math.max(0, args.stoppedAt - row.e2bMeteringStartedAt)
    );
    const cpuCount = row.e2bCpuCount ?? 2;
    const memoryMB = row.e2bMemoryMB ?? 2_048;
    await ctx.db.patch(row._id, {
      e2bRunningMs: runningMs,
      e2bMeteringStartedAt: undefined,
      latestTotalPrice: estimatedE2BPrice(runningMs, cpuCount, memoryMB),
      lastSyncedAt: args.stoppedAt,
      updatedAt: args.stoppedAt,
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
    if (row.status === "finalized" || (args.finalize && row.status !== "pending_finalization")) return null;
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
    sandboxProvider: sandboxProviderValidator,
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
        sandboxProvider: args.sandboxProvider,
        daytonaOrganizationId: args.sandboxProvider === "daytona" ? requireDaytonaOrganizationId() : undefined,
        costSource: args.sandboxProvider === "e2b" ? "estimated" : "authoritative",
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
