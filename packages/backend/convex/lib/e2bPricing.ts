// Current public E2B compute rates. E2B does not expose invoice totals through
// the sandbox SDK, so billing uses these rates for a clearly labeled estimate.
export const E2B_CPU_PRICE_PER_SECOND = 0.000014;
export const E2B_MEMORY_GIB_PRICE_PER_SECOND = 0.0000045;

export function estimatedE2BPrice(runningMs: number, cpuCount: number, memoryMB: number) {
  const seconds = Math.max(0, runningMs) / 1_000;
  return seconds * (
    Math.max(0, cpuCount) * E2B_CPU_PRICE_PER_SECOND
    + (Math.max(0, memoryMB) / 1_024) * E2B_MEMORY_GIB_PRICE_PER_SECOND
  );
}
