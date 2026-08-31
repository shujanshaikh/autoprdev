import { describe, expect, it } from "vitest";

import {
  e2bMeteringAt,
  estimatedE2BPrice,
} from "@autopr/backend/convex/lib/e2bPricing";

describe("E2B sandbox cost estimates", () => {
  it("prices metered CPU and memory runtime", () => {
    expect(estimatedE2BPrice(60 * 60_000, 2, 2_048)).toBeCloseTo(0.1332, 10);
  });

  it("never reports a negative cost for invalid metering data", () => {
    expect(estimatedE2BPrice(-1, -2, -512)).toBe(0);
  });

  it("finalizes accumulated and active metering without a provider request", () => {
    expect(e2bMeteringAt({
      runningMs: 30_000,
      startedAt: 10_000,
      cpuCount: 8,
      memoryMB: 8_192,
    }, 40_000)).toEqual({
      runningMs: 60_000,
      cpuCount: 8,
      memoryMB: 8_192,
      totalPrice: estimatedE2BPrice(60_000, 8, 8_192),
    });
  });

  it("does not add negative runtime when timestamps arrive out of order", () => {
    expect(e2bMeteringAt({ runningMs: 30_000, startedAt: 50_000 }, 40_000).runningMs)
      .toBe(30_000);
  });
});
