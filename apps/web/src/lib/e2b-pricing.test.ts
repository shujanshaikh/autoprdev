import { describe, expect, it } from "vitest";

import { estimatedE2BPrice } from "@autopr/backend/convex/lib/e2bPricing";

describe("E2B sandbox cost estimates", () => {
  it("prices metered CPU and memory runtime", () => {
    expect(estimatedE2BPrice(60 * 60_000, 2, 2_048)).toBeCloseTo(0.1332, 10);
  });

  it("never reports a negative cost for invalid metering data", () => {
    expect(estimatedE2BPrice(-1, -2, -512)).toBe(0);
  });
});
