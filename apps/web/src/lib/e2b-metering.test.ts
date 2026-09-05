import { afterEach, describe, expect, it, vi } from "vitest";
import type { Doc } from "@autopr/backend/convex/_generated/dataModel";
import {
  recordE2BSyncSuccessInternal as syncMutation,
  startE2BMeteringInternal as startMutation,
  stopE2BMeteringInternal as stopMutation,
} from "@autopr/backend/convex/sandboxCosts";

function meteringContext(overrides: Partial<Doc<"sandboxCosts">> = {}) {
  const row = {
    _id: "cost-1",
    status: "active",
    sandboxProvider: "e2b",
    e2bRunningMs: 60_000,
    e2bMeteringStartedAt: 100_000,
    lastSyncedAt: 100_000,
    ...overrides,
  };
  const patch = vi.fn(async (_id: string, changes: Partial<Doc<"sandboxCosts">>) => {
    Object.assign(row, changes);
  });
  const ctx = {
    db: {
      query: () => ({ withIndex: () => ({ unique: async () => row }) }),
      patch,
    },
  };
  return { ctx, row, patch };
}

const snapshot = {
  sandboxId: "sandbox-1",
  startedAt: 0,
  meteredUntil: 200_000,
  checkedAt: 200_000,
  running: true,
  cpuCount: 8,
  memoryMB: 8_192,
  finalize: false,
};

// Convex exposes the original handlers at runtime but strips them from its public types.
const recordE2BSyncSuccessInternal = syncMutation as unknown as {
  _handler: (ctx: unknown, args: typeof snapshot) => Promise<boolean>;
};
const startE2BMeteringInternal = startMutation as unknown as {
  _handler: (ctx: unknown, args: { sandboxId: string }) => Promise<null>;
};
const stopE2BMeteringInternal = stopMutation as unknown as {
  _handler: (ctx: unknown, args: { sandboxId: string; stoppedAt: number }) => Promise<null>;
};

describe("E2B cost lifecycle", () => {
  afterEach(() => vi.useRealTimers());

  it("refreshes a paused sandbox's cost without billing the time spent paused", async () => {
    const { ctx, row } = meteringContext();
    const paused = { ...snapshot, running: false, meteredUntil: 150_000 };

    expect(await recordE2BSyncSuccessInternal._handler(ctx, paused)).toBe(true);
    expect(row.e2bRunningMs).toBe(110_000);
    expect(row.e2bMeteringStartedAt).toBeUndefined();
    expect(await recordE2BSyncSuccessInternal._handler(ctx, {
      ...paused, checkedAt: 500_000,
    })).toBe(true);
    expect(row.e2bRunningMs).toBe(110_000);
    expect(row.lastSyncedAt).toBe(500_000);
  });

  it("does not count a pause gap when the sandbox resumes between cost syncs", async () => {
    const { ctx, row } = meteringContext();

    await recordE2BSyncSuccessInternal._handler(ctx, {
      ...snapshot, startedAt: 180_000,
    });

    expect(row.e2bRunningMs).toBe(80_000);
  });

  it("rejects a running snapshot fetched before an explicit stop", async () => {
    const { ctx, row, patch } = meteringContext();
    await stopE2BMeteringInternal._handler(ctx, { sandboxId: "sandbox-1", stoppedAt: 160_000 });
    patch.mockClear();

    expect(await recordE2BSyncSuccessInternal._handler(ctx, {
      ...snapshot, checkedAt: 150_000,
    })).toBe(false);
    expect(patch).not.toHaveBeenCalled();
    expect(row.e2bMeteringStartedAt).toBeUndefined();
  });

  it("rejects a paused snapshot fetched before an explicit start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(180_000);
    const { ctx, row } = meteringContext({ e2bMeteringStartedAt: undefined });
    await startE2BMeteringInternal._handler(ctx, { sandboxId: "sandbox-1" });

    expect(await recordE2BSyncSuccessInternal._handler(ctx, {
      ...snapshot, running: false, checkedAt: 170_000, meteredUntil: 100_000,
    })).toBe(false);
    expect(row.e2bMeteringStartedAt).toBe(180_000);
  });

  it("does not change finalized cost rows when late lifecycle calls arrive", async () => {
    const { ctx, patch } = meteringContext({ status: "finalized", e2bMeteringStartedAt: undefined });

    await startE2BMeteringInternal._handler(ctx, { sandboxId: "sandbox-1" });
    await stopE2BMeteringInternal._handler(ctx, { sandboxId: "sandbox-1", stoppedAt: 200_000 });

    expect(patch).not.toHaveBeenCalled();
  });
});
