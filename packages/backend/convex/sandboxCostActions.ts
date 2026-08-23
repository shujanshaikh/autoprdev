"use node";

import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { resolvedSandboxProvider } from "./lib/sandboxProvider";

function analyticsConfig() {
  const apiUrl = process.env.DAYTONA_ANALYTICS_API_URL;
  const organizationId = process.env.DAYTONA_ORGANIZATION_ID;
  const apiKey = process.env.DAYTONA_API_KEY;
  if (!apiUrl || !organizationId || !apiKey) {
    throw new ConvexError({
      code: "DAYTONA_ANALYTICS_CONFIG_MISSING",
      message: "DAYTONA_ANALYTICS_API_URL, DAYTONA_ORGANIZATION_ID, and DAYTONA_API_KEY are required.",
    });
  }
  return { apiUrl, organizationId, apiKey };
}

function rowsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["sandboxes", "items", "data", "usage"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

async function fetchAuthoritativeTotal(sandboxId: string, from: number, to: number) {
  const { apiUrl, organizationId, apiKey } = analyticsConfig();
  const url = new URL(
    `organization/${encodeURIComponent(organizationId)}/usage/sandbox`,
    apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`,
  );
  url.searchParams.set("from", new Date(from).toISOString());
  url.searchParams.set("to", new Date(to).toISOString());
  const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(`Daytona analytics request failed (${response.status}).`);
  const payload: unknown = await response.json();
  const match = rowsFromPayload(payload).find((value) => {
    if (!value || typeof value !== "object") return false;
    const row = value as Record<string, unknown>;
    return row.sandboxId === sandboxId || row.sandbox_id === sandboxId;
  }) as Record<string, unknown> | undefined;
  const totalPrice = match?.totalPrice ?? match?.total_price;
  if (typeof totalPrice !== "number") {
    throw new Error(match ? "Daytona aggregate row has no totalPrice." : "Sandbox has not appeared in Daytona analytics yet.");
  }
  return totalPrice;
}

async function fetchE2BMeteringSnapshot(sandboxId: string) {
  const { Sandbox } = await import("e2b");
  const info = await Sandbox.getInfo(sandboxId, { requestTimeoutMs: 120_000 });
  const now = Date.now();
  return {
    cpuCount: info.cpuCount,
    memoryMB: info.memoryMB,
    startedAt: info.startedAt.getTime(),
    running: info.state === "running",
    meteredUntil: info.state === "running"
      ? now
      : Math.min(now, info.endAt.getTime()),
  };
}

export const syncOneSandboxCost = internalAction({
  args: { sandboxId: v.string(), finalize: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.sandboxCosts.getBySandboxIdInternal, { sandboxId: args.sandboxId });
    if (!row || (args.finalize ? row.status !== "pending_finalization" : row.status !== "active")) return null;
    try {
      if (resolvedSandboxProvider(row.sandboxProvider) === "e2b") {
        const snapshot = await fetchE2BMeteringSnapshot(row.sandboxId);
        await ctx.runMutation(internal.sandboxCosts.recordE2BSyncSuccessInternal, {
          sandboxId: row.sandboxId,
          ...snapshot,
          finalize: args.finalize,
        });
        return null;
      }
      const totalPrice = await fetchAuthoritativeTotal(row.sandboxId, row.sandboxCreatedAt, Date.now());
      await ctx.runMutation(internal.sandboxCosts.recordSyncSuccessInternal, {
        sandboxId: row.sandboxId,
        totalPrice,
        finalize: args.finalize,
      });
    } catch (error) {
      await ctx.runMutation(internal.sandboxCosts.recordSyncFailureInternal, {
        sandboxId: row.sandboxId,
        error: error instanceof Error ? error.message : "Sandbox cost sync failed.",
        finalize: args.finalize,
      });
    }
    return null;
  },
});

export const batchSyncActiveSandboxCosts = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const rows = await ctx.runQuery(internal.sandboxCosts.listDueInternal, { now: Date.now(), status: "active" });
    await Promise.all(rows.map((row) => ctx.runAction(internal.sandboxCostActions.syncOneSandboxCost, {
      sandboxId: row.sandboxId,
      finalize: false,
    })));
    return null;
  },
});

export const finalizePendingDeletedSandboxCosts = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const rows = await ctx.runQuery(internal.sandboxCosts.listDueInternal, {
      now: Date.now(),
      status: "pending_finalization",
    });
    await Promise.all(rows.map((row) => ctx.runAction(internal.sandboxCostActions.syncOneSandboxCost, {
      sandboxId: row.sandboxId,
      finalize: true,
    })));
    return null;
  },
});
