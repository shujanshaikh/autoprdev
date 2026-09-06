import { afterEach, describe, expect, it, vi } from "vitest";
import type { FunctionArgs } from "convex/server";
import { internal } from "@autopr/backend/convex/_generated/api";
import type { Doc } from "@autopr/backend/convex/_generated/dataModel";
import {
  recordE2BUsageInternal as usageMutation,
  startE2BMeteringInternal as startMutation,
  stopE2BMeteringInternal as stopMutation,
} from "@autopr/backend/convex/sandboxCosts";
import { estimatedE2BPrice } from "@autopr/backend/convex/lib/e2bPricing";
import type { E2BUsageEvent } from "@autopr/backend/convex/lib/e2bUsage";

function meteringContext(overrides: Partial<Doc<"sandboxCosts">> = {}) {
  const row: Partial<Doc<"sandboxCosts">> = {
    status: "active", sandboxProvider: "e2b", sandboxId: "sandbox-1",
    e2bRunningMs: 500_000_000, latestTotalPrice: 63.64,
    e2bCpuCount: 8, e2bMemoryMB: 8_192,
    ...overrides,
  };
  const executions: Array<Partial<Doc<"e2bSandboxExecutions">>> = [];
  const patch = vi.fn(async (id: string | undefined, changes: object) => {
    Object.assign(id === undefined ? row : executions.find((item) => item._id === id)!, changes);
  });
  const ctx = {
    db: {
      query: (table: string) => ({ withIndex: () => ({
        unique: async () => row,
        collect: async () => table === "e2bSandboxExecutions" ? executions : [row],
      }) }),
      patch,
      insert: async (_table: string, fields: object) => {
        executions.push({ ...fields, _id: `execution-${executions.length}` as Doc<"e2bSandboxExecutions">["_id"] });
      },
    },
    scheduler: { runAfter: vi.fn() },
  };
  return { ctx, row, executions, patch };
}

const recordUsage = usageMutation as unknown as {
  _handler: (ctx: unknown, args: FunctionArgs<typeof internal.sandboxCosts.recordE2BUsageInternal>) => Promise<boolean>;
};
const start = startMutation as unknown as {
  _handler: (ctx: unknown, args: FunctionArgs<typeof internal.sandboxCosts.startE2BMeteringInternal>) => Promise<null>;
};
const stop = stopMutation as unknown as {
  _handler: (ctx: unknown, args: FunctionArgs<typeof internal.sandboxCosts.stopE2BMeteringInternal>) => Promise<null>;
};

function event(type: string, timestamp: number, executionId = "run-1"): E2BUsageEvent {
  return { id: `${type}-${executionId}`, type: `sandbox.lifecycle.${type}`, timestamp,
    sandboxId: "sandbox-1", executionId };
}
const created = event("created", 100_000);
const paused = {
  ...event("paused", 160_000),
  execution: { started_at: 100_000, vcpu_count: 2, memory_mb: 2_048, execution_time: 60_000 },
};
const snapshot = { startedAt: 100_000, endAt: 900_000, running: false, cpuCount: 2, memoryMB: 2_048 };
const args = { sandboxId: "sandbox-1", checkedAt: 200_000, events: [created, paused], snapshot };

describe("E2B provider usage reconciliation", () => {
  afterEach(() => vi.useRealTimers());

  it("repairs inflated legacy usage and never bills paused time or retries twice", async () => {
    const { ctx, row, executions } = meteringContext();
    await recordUsage._handler(ctx, args);
    await recordUsage._handler(ctx, { ...args, checkedAt: 500_000 });
    expect(row.e2bRunningMs).toBe(60_000);
    expect(row.latestTotalPrice).toBeCloseTo(estimatedE2BPrice(60_000, 2, 2_048), 10);
    expect(row.e2bState).toBe("paused");
    expect(row.e2bUsageHistoryComplete).toBe(true);
    expect(executions).toHaveLength(1);
  });

  it("prices each execution's resources and excludes the pause gap on resume", async () => {
    const { ctx, row } = meteringContext();
    await recordUsage._handler(ctx, args);
    await recordUsage._handler(ctx, { ...args, checkedAt: 550_000,
      events: [created, paused, event("resumed", 500_000, "run-2")],
      snapshot: { startedAt: 500_000, endAt: 600_000, running: true, cpuCount: 8, memoryMB: 8_192 },
    });
    expect(row.e2bRunningMs).toBe(110_000);
    expect(row.latestTotalPrice).toBeCloseTo(
      estimatedE2BPrice(60_000, 2, 2_048) + estimatedE2BPrice(50_000, 8, 8_192), 10,
    );
  });

  it("uses provider execution_time even when event delivery timestamps are later", async () => {
    const { ctx, row } = meteringContext();
    await recordUsage._handler(ctx, { ...args, events: [created, { ...paused, timestamp: 190_000 }] });
    expect(row.e2bRunningMs).toBe(60_000);
  });

  it("finalizes external deletion without billing days between pause and kill", async () => {
    const { ctx, row } = meteringContext();
    await recordUsage._handler(ctx, { ...args, checkedAt: 50_000_000, snapshot: null,
      events: [created, paused, event("killed", 40_000_000)],
    });
    expect(row.status).toBe("finalized");
    expect(row.deletedAt).toBe(40_000_000);
    expect(row.e2bRunningMs).toBe(60_000);
    expect(row.finalTotalPrice).toBe(row.latestTotalPrice);
  });

  it("retains executions when they disappear from the provider retention window", async () => {
    const { ctx, row, executions } = meteringContext();
    await recordUsage._handler(ctx, args);
    await recordUsage._handler(ctx, { ...args, events: [], checkedAt: 500_000 });
    expect(row.e2bRunningMs).toBe(60_000);
    expect(row.e2bUsageHistoryComplete).toBe(true);
    expect(executions).toHaveLength(1);
  });

  it("shows unknown history instead of inventing a lifetime charge after retention expires", async () => {
    const { ctx, row } = meteringContext({ status: "finalized", deletedAt: 0 });
    await recordUsage._handler(ctx, { ...args, events: [], snapshot: null });
    expect(row.e2bUsageHistoryComplete).toBe(false);
    expect(row.latestTotalPrice).toBeUndefined();
    expect(row.finalTotalPrice).toBeUndefined();
    expect(row.status).toBe("finalized");
  });

  it("moves a missing active sandbox out of the active count while waiting for terminal events", async () => {
    const { ctx, row } = meteringContext();
    vi.useFakeTimers();
    vi.setSystemTime(200_000);
    await recordUsage._handler(ctx, { ...args, events: [created], snapshot: null });
    expect(row.status).toBe("pending_finalization");
    expect(row.e2bState).toBe("killed");
    expect(row.nextSyncAt).toBeGreaterThan(200_000);
    await recordUsage._handler(ctx, { ...args, checkedAt: 250_000, snapshot: null,
      events: [created, { ...paused, type: "sandbox.lifecycle.killed" }],
    });
    expect(row.status).toBe("finalized");
    expect(row.e2bRunningMs).toBe(60_000);
  });

  it("supports v1 event timestamps and deduplicates pause followed by kill", async () => {
    const { ctx, row } = meteringContext();
    await recordUsage._handler(ctx, { ...args, snapshot: null,
      events: [created, event("paused", 160_000), event("killed", 900_000)],
    });
    expect(row.e2bRunningMs).toBe(60_000);
  });

  it("corrects a v1 execution when its earlier pause arrives after the kill", async () => {
    const { ctx, row } = meteringContext();
    await recordUsage._handler(ctx, { ...args, snapshot: null, events: [created, event("killed", 900_000)] });
    await recordUsage._handler(ctx, { ...args, checkedAt: 300_000, snapshot: null,
      events: [created, event("paused", 160_000), event("killed", 900_000)],
    });
    expect(row.e2bRunningMs).toBe(60_000);
  });

  it("rejects snapshots fetched before a local pause and avoids local wall-clock metering", async () => {
    const { ctx, row } = meteringContext();
    vi.useFakeTimers();
    vi.setSystemTime(300_000);
    await stop._handler(ctx, { sandboxId: "sandbox-1", stoppedAt: 300_000 });
    expect(await recordUsage._handler(ctx, { ...args, snapshot: { ...snapshot, running: true } })).toBe(false);
    expect(row.e2bState).toBe("paused");
    expect(row.e2bRunningMs).toBe(500_000_000);
    expect(ctx.scheduler.runAfter).toHaveBeenCalledOnce();
  });

  it("does not restart metering on finalized rows", async () => {
    const { ctx, patch } = meteringContext({ status: "finalized" });
    await start._handler(ctx, { sandboxId: "sandbox-1" });
    expect(patch).not.toHaveBeenCalled();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });
});
