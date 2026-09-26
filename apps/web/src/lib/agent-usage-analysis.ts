import { z } from "zod";

const count = z.number().finite().nonnegative();
const optionalCount = count.nullable().optional();
const costSchema = z.object({
  input: optionalCount, cacheRead: optionalCount, cacheWrite: optionalCount,
  output: optionalCount, total: count,
});
const requestSchema = z.object({
  event: z.literal("agent_request"), requestId: z.string(), turnId: z.string(), status: z.string(),
  modelId: z.string().optional(), provider: z.string().optional(), role: z.string().optional(),
  purpose: z.string().optional(), promptVariant: z.string().optional(),
  readOutputVariant: z.string().optional(),
  inputTokens: optionalCount, uncachedInputTokens: optionalCount, cachedInputTokens: optionalCount,
  outputTokens: optionalCount, cacheWriteTokens: optionalCount, durationMs: optionalCount,
  apiEquivalentCost: costSchema.nullable().optional(),
  sourceChars: z.record(z.string(), count).optional(), staticChars: optionalCount,
  toolNames: z.array(z.string()).optional(),
});
const toolSchema = z.object({
  event: z.literal("agent_tool"), turnId: z.string(), toolCallId: z.string(), toolName: z.string(),
  role: z.string().optional(), modelId: z.string().optional(), errorCategory: z.string().nullable(),
});
const taskSchema = z.array(z.object({
  taskId: z.string().min(1), turnIds: z.array(z.string().min(1)).min(1), completed: z.boolean(),
}));
type Request = z.infer<typeof requestSchema>;

function summarizeRequests(calls: Request[]) {
  const finished = calls.filter((call) => call.status === "finished");
  const sum = (field: "inputTokens" | "uncachedInputTokens" | "cachedInputTokens" | "outputTokens" | "cacheWriteTokens") =>
    finished.reduce((total, call) => total + (call[field] ?? 0), 0);
  const completeUsage = calls.length > 0 && calls.every((call) => call.status === "finished"
    && call.inputTokens != null && call.cachedInputTokens != null && call.outputTokens != null);
  const completeCost = completeUsage && calls.every((call) => call.apiEquivalentCost != null);
  const costByBillingType = Object.fromEntries((["input", "cacheRead", "cacheWrite", "output"] as const).map((field) => [
    field, completeCost && finished.every((call) => call.apiEquivalentCost?.[field] != null)
      ? finished.reduce((sum, call) => sum + call.apiEquivalentCost![field]!, 0) : null,
  ]));
  const sourceChars: Record<string, number> = {};
  for (const call of calls) for (const [source, chars] of Object.entries(call.sourceChars ?? {})) {
    sourceChars[source] = (sourceChars[source] ?? 0) + chars;
  }
  const staticSizes = calls.flatMap((call) => call.staticChars == null ? [] : [call.staticChars]);
  return {
    requests: calls.length,
    requestsWithoutUsage: calls.filter((call) => call.status !== "finished"
      || call.inputTokens == null || call.cachedInputTokens == null || call.outputTokens == null).length,
    apiEquivalentCost: completeCost ? finished.reduce((sum, call) => sum + call.apiEquivalentCost!.total, 0) : null,
    costByBillingType,
    observedInputTokens: sum("inputTokens"), observedUncachedInputTokens: sum("uncachedInputTokens"),
    observedCachedInputTokens: sum("cachedInputTokens"), observedOutputTokens: sum("outputTokens"),
    observedCacheWriteTokens: sum("cacheWriteTokens"),
    requestsWithoutCacheWriteUsage: calls.filter((call) => call.status !== "finished" || call.cacheWriteTokens == null).length,
    cacheReadFraction: completeUsage && sum("inputTokens") > 0 ? sum("cachedInputTokens") / sum("inputTokens") : null,
    cacheHitRate: completeUsage ? finished.filter((call) => call.cachedInputTokens! > 0).length / calls.length : null,
    meanRequestDurationMs: calls.length > 0 && calls.every((call) => call.durationMs != null)
      ? calls.reduce((sum, call) => sum + call.durationMs!, 0) / calls.length : null,
    sourceChars,
    meanStaticChars: staticSizes.length ? staticSizes.reduce((sum, chars) => sum + chars, 0) / staticSizes.length : null,
    requestsWithoutSourceProfile: calls.filter((call) => !call.sourceChars).length,
  };
}

/** Reviewer task labels include retries and follow-up turns; finish reasons are not success labels. */
export function analyzeAgentUsage(events: unknown[], taskLabels: unknown) {
  const tasks = taskSchema.parse(taskLabels);
  const taskIds = new Set<string>();
  const seenTurns = new Set<string>();
  for (const task of tasks) {
    if (taskIds.has(task.taskId)) throw new Error(`Duplicate task: ${task.taskId}`);
    taskIds.add(task.taskId);
    for (const turnId of task.turnIds) {
      if (seenTurns.has(turnId)) throw new Error(`Turn assigned more than once: ${turnId}`);
      seenTurns.add(turnId);
    }
  }
  const requests = new Map<string, Request>();
  const tools = new Map<string, z.infer<typeof toolSchema>>();
  const erroredRequests = new Set<string>();
  for (const value of events) {
    if (typeof value !== "object" || value === null || !("event" in value)) continue;
    if (value.event === "agent_request") {
      // A malformed usage event must not quietly disappear from the cost numerator.
      const request = requestSchema.parse(value);
      if (["provider_error", "stream_error"].includes(request.status)) erroredRequests.add(request.requestId);
      const existing = requests.get(request.requestId);
      if (existing?.status !== "finished") requests.set(request.requestId, { ...existing, ...request });
    } else if (value.event === "agent_tool") {
      const tool = toolSchema.parse(value);
      tools.set(`${tool.turnId}:${tool.role ?? "unknown"}:${tool.toolCallId}`, tool);
    }
  }
  const assignedRequests = [...requests.values()].filter((request) => seenTurns.has(request.turnId));
  const taskResults = tasks.map((task) => {
    const turns = new Set(task.turnIds);
    const calls = assignedRequests.filter((request) => turns.has(request.turnId));
    const missingTurns = task.turnIds.filter((turn) => !calls.some((call) => call.turnId === turn));
    const summary = summarizeRequests(calls);
    return {
      ...task, ...summary, turns: turns.size, missingTurns,
      apiEquivalentCost: missingTurns.length ? null : summary.apiEquivalentCost,
      costByBillingType: missingTurns.length
        ? { input: null, cacheRead: null, cacheWrite: null, output: null } : summary.costByBillingType,
    };
  });
  const assignedTools = [...tools.values()].filter((tool) => seenTurns.has(tool.turnId));
  const toolNames = new Set([
    ...assignedRequests.flatMap((request) => request.toolNames ?? []),
    ...assignedTools.map((tool) => tool.toolName),
  ]);
  const toolResults = [...toolNames].sort().map((toolName) => {
    const calls = assignedTools.filter((tool) => tool.toolName === toolName);
    const turns = new Set(calls.map((call) => call.turnId));
    const errorsByCategory: Record<string, number> = {};
    for (const call of calls) if (call.errorCategory !== null) {
      errorsByCategory[call.errorCategory] = (errorsByCategory[call.errorCategory] ?? 0) + 1;
    }
    return {
      toolName, calls: calls.length,
      shareOfTasks: tasks.length ? tasks.filter((task) => task.turnIds.some((turn) => turns.has(turn))).length / tasks.length : null,
      shareOfTurns: seenTurns.size ? turns.size / seenTurns.size : null,
      errorRate: calls.length ? calls.filter((call) => call.errorCategory !== null).length / calls.length : null,
      errorsByCategory,
    };
  });
  const groups = new Map<string, Request[]>();
  for (const request of assignedRequests) {
    const key = JSON.stringify([request.provider, request.modelId, request.role, request.purpose, request.promptVariant, request.readOutputVariant]);
    const group = groups.get(key) ?? [];
    group.push(request);
    groups.set(key, group);
  }
  const completed = tasks.filter((task) => task.completed).length;
  return {
    tasks: taskResults, tools: toolResults,
    requestGroups: [...groups.values()].map((calls) => ({
      provider: calls[0]!.provider, modelId: calls[0]!.modelId, role: calls[0]!.role,
      purpose: calls[0]!.purpose, promptVariant: calls[0]!.promptVariant,
      readOutputVariant: calls[0]!.readOutputVariant, ...summarizeRequests(calls),
    })),
    completedTasks: completed,
    completionRate: tasks.length ? completed / tasks.length : null,
    meanTurnsPerTask: tasks.length ? seenTurns.size / tasks.length : null,
    // Failed-task spend belongs in the numerator. Unknown spend cannot become zero.
    apiEquivalentCostPerCompletedTask: completed && taskResults.every((task) => task.apiEquivalentCost !== null)
      ? taskResults.reduce((sum, task) => sum + task.apiEquivalentCost!, 0) / completed : null,
    requestsWithErrors: assignedRequests.filter((request) => erroredRequests.has(request.requestId)).length,
    unassignedRequests: requests.size - assignedRequests.length,
    // Providers report aggregate usage, not billing attribution to prompt sections.
    costBySourceAndBillingType: null,
    sourceMeasurement: "SDK section characters; not tokenizer counts or billed token shares",
  };
}
