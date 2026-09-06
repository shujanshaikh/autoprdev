import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireUserId } from "./lib/auth";
import { E2B_DEFAULT_CPU_COUNT, E2B_DEFAULT_MEMORY_MB, estimatedE2BPrice } from "./lib/e2bPricing";
import { mergeE2BExecutions } from "./lib/e2bUsage";
import { sandboxProviderValidator } from "./lib/sandboxProvider";

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
      await ctx.db.patch(existing._id, {
        authorId: args.authorId,
        projectId: args.projectId,
        sandboxName: args.sandboxName,
        repoFullName: args.repoFullName,
        sandboxProvider: args.sandboxProvider,
        daytonaOrganizationId,
        costSource: args.sandboxProvider === "e2b" ? "estimated" : "authoritative",
        e2bCpuCount: args.e2bCpuCount ?? existing.e2bCpuCount,
        e2bMemoryMB: args.e2bMemoryMB ?? existing.e2bMemoryMB,
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
      .withIndex("by_next_sync", (q) => q.gte("nextSyncAt", 0).lte("nextSyncAt", args.now))
      .collect();
    const due = rows.filter((row) => row.status === args.status || (args.status === "active" &&
      row.status === "finalized" && row.sandboxProvider === "e2b" && row.nextSyncAt !== undefined));
    if (args.status === "active") {
      // Reconcile old finalized estimates once, while provider history is still available.
      const legacy = await ctx.db.query("sandboxCosts")
        .withIndex("by_next_sync", (q) => q.eq("nextSyncAt", undefined))
        .filter((q) => q.and(
          q.eq(q.field("sandboxProvider"), "e2b"),
          q.eq(q.field("status"), "finalized"),
          q.eq(q.field("e2bUsageVersion"), undefined),
        )).take(20);
      return [...due, ...legacy];
    }
    return due;
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

const e2bEventValidator = v.object({
  id: v.string(),
  type: v.string(),
  timestamp: v.number(),
  sandboxId: v.string(),
  executionId: v.string(),
  execution: v.optional(v.object({
    started_at: v.number(),
    vcpu_count: v.number(),
    memory_mb: v.number(),
    execution_time: v.number(),
  })),
});

/** Reconciles provider execution history without adding locally elapsed pause or deletion time. */
export const recordE2BUsageInternal = internalMutation({
  args: {
    sandboxId: v.string(),
    checkedAt: v.number(),
    events: v.array(e2bEventValidator),
    snapshot: v.union(v.null(), v.object({
      startedAt: v.number(),
      endAt: v.number(),
      running: v.boolean(),
      cpuCount: v.number(),
      memoryMB: v.number(),
    })),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.query("sandboxCosts")
      .withIndex("by_sandbox_id", (q) => q.eq("sandboxId", args.sandboxId)).unique();
    if (!row || row.sandboxProvider !== "e2b") return false;
    if (row.lastSyncedAt !== undefined && args.checkedAt < row.lastSyncedAt) return false;
    const previous = await ctx.db.query("e2bSandboxExecutions")
      .withIndex("by_sandbox_id", (q) => q.eq("sandboxId", args.sandboxId)).collect();
    const executions = mergeE2BExecutions(previous, args.events);
    const previousById = new Map(previous.map((execution) => [execution.executionId, execution]));
    for (const execution of executions) {
      const existing = previousById.get(execution.executionId);
      if (existing) {
        if (existing.startedAt !== execution.startedAt || existing.stoppedAt !== execution.stoppedAt ||
          existing.runningMs !== execution.runningMs || existing.cpuCount !== execution.cpuCount ||
          existing.memoryMB !== execution.memoryMB || existing.providerMeasured !== execution.providerMeasured) {
          await ctx.db.patch(existing._id, execution);
        }
      } else {
        await ctx.db.insert("e2bSandboxExecutions", { sandboxId: args.sandboxId, ...execution });
      }
    }

    const now = Date.now();
    const snapshot = args.snapshot;
    const cpuCount = snapshot?.cpuCount ?? row.e2bCpuCount ?? E2B_DEFAULT_CPU_COUNT;
    const memoryMB = snapshot?.memoryMB ?? row.e2bMemoryMB ?? E2B_DEFAULT_MEMORY_MB;
    const completed = executions.filter((execution) => execution.runningMs !== undefined);
    const lastStoppedAt = Math.max(0, ...completed.map((execution) => execution.stoppedAt ?? 0));
    const activeRunningMs = snapshot?.running && snapshot.startedAt >= lastStoppedAt
      ? Math.max(0, Math.min(args.checkedAt, snapshot.endAt) - snapshot.startedAt)
      : 0;
    const runningMs = completed.reduce((sum, execution) => sum + (execution.runningMs ?? 0), activeRunningMs);
    const totalPrice = completed.reduce((sum, execution) => sum + estimatedE2BPrice(
      execution.runningMs ?? 0, execution.cpuCount ?? cpuCount, execution.memoryMB ?? memoryMB,
    ), estimatedE2BPrice(activeRunningMs, cpuCount, memoryMB));
    const createdEvent = args.events.find((event) => event.type === "sandbox.lifecycle.created");
    const killedAt = args.events.filter((event) => event.type === "sandbox.lifecycle.killed")
      .reduce<number | undefined>((latest, event) => Math.max(latest ?? 0, event.timestamp), undefined);
    // Poll within the provider's default seven-day retention window to preserve continuity.
    const historyComplete = Boolean(createdEvent || (row.e2bUsageHistoryComplete &&
      row.e2bUsageSyncedAt !== undefined && args.checkedAt - row.e2bUsageSyncedAt < 7 * 24 * 60 * 60_000));
    const currentExecution = snapshot?.running ? executions.filter((execution) =>
      execution.runningMs === undefined).sort((a, b) => b.startedAt - a.startedAt)[0] : undefined;
    const missingExecution = executions.some((execution) => execution.runningMs === undefined &&
      execution.executionId !== currentExecution?.executionId) || args.events.some((event) =>
      (event.type === "sandbox.lifecycle.paused" || event.type === "sandbox.lifecycle.killed") &&
      !executions.some((execution) => execution.executionId === event.executionId && execution.runningMs !== undefined));
    const deletedAt = snapshot ? row.deletedAt : killedAt ?? row.deletedAt ?? args.checkedAt;
    // Give terminal events time to arrive after a confirmed 404, including external deletion.
    const finalized = !snapshot && (killedAt !== undefined || row.status === "finalized" ||
      now - (deletedAt ?? now) >= FINALIZATION_WINDOW_MS);
    const complete = historyComplete && !missingExecution && (snapshot !== null || killedAt !== undefined);
    const settled = complete && killedAt !== undefined && args.checkedAt - killedAt >= ACTIVE_SYNC_INTERVAL_MS;
    const hasUsage = completed.length > 0 || snapshot?.running === true;
    await ctx.db.patch(row._id, {
      costSource: "estimated",
      e2bCpuCount: cpuCount,
      e2bMemoryMB: memoryMB,
      e2bRunningMs: runningMs,
      e2bMeteringStartedAt: undefined,
      e2bUsageVersion: 1,
      e2bUsageSyncedAt: args.checkedAt,
      e2bUsageHistoryComplete: complete,
      e2bState: snapshot ? snapshot.running ? "running" : "paused" : "killed",
      latestTotalPrice: hasUsage || complete ? totalPrice : undefined,
      finalTotalPrice: finalized && (hasUsage || complete) ? totalPrice : undefined,
      status: finalized ? "finalized" : !snapshot || row.status === "pending_finalization"
        ? "pending_finalization" : "active",
      sandboxCreatedAt: createdEvent?.timestamp ?? row.sandboxCreatedAt,
      deletedAt,
      finalizedAt: finalized ? now : undefined,
      lastSyncedAt: args.checkedAt,
      syncError: complete ? undefined : "E2B execution history is incomplete; only recovered usage is included.",
      nextSyncAt: finalized && (settled || now - (deletedAt ?? now) >= FINALIZATION_WINDOW_MS)
        ? undefined : now + ACTIVE_SYNC_INTERVAL_MS,
      updatedAt: now,
    });
    return finalized || snapshot !== null;
  },
});

// Local controls only refresh provider usage. They must never accumulate wall-clock time.
async function scheduleE2BUsageSync(ctx: MutationCtx, sandboxId: string, running: boolean) {
  const row = await ctx.db.query("sandboxCosts")
    .withIndex("by_sandbox_id", (q) => q.eq("sandboxId", sandboxId)).unique();
  if (!row || row.sandboxProvider !== "e2b" || row.status !== "active") return;
  const now = Date.now();
  await ctx.db.patch(row._id, {
    e2bState: running ? "running" : "paused",
    lastSyncedAt: now,
    nextSyncAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.sandboxCostActions.syncOneSandboxCost, {
    sandboxId, finalize: false,
  });
}

export const startE2BMeteringInternal = internalMutation({
  args: { sandboxId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await scheduleE2BUsageSync(ctx, args.sandboxId, true);
    return null;
  },
});

export const stopE2BMeteringInternal = internalMutation({
  args: { sandboxId: v.string(), stoppedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await scheduleE2BUsageSync(ctx, args.sandboxId, false);
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
    const reconcileE2B = row.sandboxProvider === "e2b" &&
      (row.e2bUsageVersion === undefined || row.nextSyncAt !== undefined);
    if (!reconcileE2B && (row.status === "finalized" ||
      (args.finalize && row.status !== "pending_finalization"))) return null;
    const now = Date.now();
    const attempts = args.finalize ? row.finalizationAttempts + 1 : row.finalizationAttempts;
    const nextSyncAt = reconcileE2B ? now + ACTIVE_SYNC_INTERVAL_MS : args.finalize
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
    if (row.status === "finalized") return null;
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
