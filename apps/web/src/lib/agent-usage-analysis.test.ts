import { describe, expect, it } from "vitest";
import { analyzeAgentUsage } from "./agent-usage-analysis";

const request = {
  event: "agent_request", requestId: "r1", turnId: "t1", status: "finished",
  role: "parent", purpose: "task", modelId: "gpt-5.5", promptVariant: "baseline",
  inputTokens: 100, uncachedInputTokens: 60, cachedInputTokens: 40, outputTokens: 20,
  cacheWriteTokens: 0, durationMs: 200,
  apiEquivalentCost: { input: 0.3, cacheRead: 0.02, cacheWrite: 0, output: 0.6, total: 0.92 },
  sourceChars: { system: 100, tools: 200, user: 10 }, staticChars: 300, toolNames: ["read", "bash"],
};
const task = { taskId: "task", turnIds: ["t1"], completed: true };

describe("task usage analysis", () => {
  it("counts subagents, compaction, failed tasks and repeated requests exactly once", () => {
    const result = analyzeAgentUsage([
      { ...request, status: "started", apiEquivalentCost: undefined }, request, request,
      { ...request, requestId: "r2", role: "subagent", purpose: "compaction" },
      { ...request, requestId: "r3", turnId: "t2" },
    ], [task, { taskId: "failed", turnIds: ["t2"], completed: false }]);
    expect(result.apiEquivalentCostPerCompletedTask).toBeCloseTo(2.76);
    expect(result.tasks[0]).toMatchObject({ requests: 2, observedInputTokens: 200, cacheHitRate: 1,
      cacheReadFraction: 0.4, costByBillingType: { input: 0.6, cacheRead: 0.04, output: 1.2 } });
    expect(result.requestGroups).toHaveLength(2);
    expect(result.completionRate).toBe(0.5);
    expect(result.costBySourceAndBillingType).toBeNull();
  });

  it("does not claim complete cost when an assigned turn, usage or price is missing", () => {
    for (const events of [[], [request], [request, { ...request, requestId: "r2", turnId: "t2", status: "started" }]]) {
      expect(analyzeAgentUsage(events, [{ ...task, turnIds: ["t1", "t2"] }]).apiEquivalentCostPerCompletedTask).toBeNull();
    }
    expect(analyzeAgentUsage([{ ...request, apiEquivalentCost: null }], [task]).apiEquivalentCostPerCompletedTask).toBeNull();
    const incomplete = analyzeAgentUsage([{ ...request, inputTokens: null }], [task]);
    expect(incomplete.tasks[0]?.requestsWithoutUsage).toBe(1);
    expect(incomplete.tasks[0]?.cacheHitRate).toBeNull();
  });

  it("reports unused tools and measures use per whole task", () => {
    const result = analyzeAgentUsage([
      request, { ...request, requestId: "r2", turnId: "t2" },
      { event: "agent_tool", turnId: "t1", toolCallId: "c1", toolName: "read", errorCategory: "timeout" },
    ], [{ ...task, turnIds: ["t1", "t2"] }]);
    expect(result.tools).toEqual([
      { toolName: "bash", calls: 0, shareOfTasks: 0, shareOfTurns: 0, errorRate: null, errorsByCategory: {} },
      { toolName: "read", calls: 1, shareOfTasks: 1, shareOfTurns: 0.5, errorRate: 1, errorsByCategory: { timeout: 1 } },
    ]);
  });

  it("rejects duplicate assignments and malformed usage instead of understating cost", () => {
    expect(() => analyzeAgentUsage([], [task, task])).toThrow("Duplicate task");
    expect(() => analyzeAgentUsage([], [task, { ...task, taskId: "other" }])).toThrow("Turn assigned more than once");
    expect(() => analyzeAgentUsage([{ ...request, inputTokens: -1 }], [task])).toThrow();
    expect(analyzeAgentUsage([request, { ...request, requestId: "other", turnId: "other" }], [task]).unassignedRequests).toBe(1);
  });
});
