// Public compute rates: https://e2b.dev/pricing
// Apply to allocated resources and execution runtime, not CPU utilization.
// Estimates exclude plan fees, credits, taxes, and negotiated pricing.
export const E2B_CPU_PRICE_PER_SECOND = 0.000014;
export const E2B_MEMORY_GIB_PRICE_PER_SECOND = 0.0000045;
export const E2B_DEFAULT_CPU_COUNT = 8;
export const E2B_DEFAULT_MEMORY_MB = 8_192;

export function estimatedE2BPrice(runningMs: number, cpuCount: number, memoryMB: number) {
  const seconds = Math.max(0, runningMs) / 1_000;
  return seconds * (
    Math.max(0, cpuCount) * E2B_CPU_PRICE_PER_SECOND
    + (Math.max(0, memoryMB) / 1_024) * E2B_MEMORY_GIB_PRICE_PER_SECOND
  );
}
