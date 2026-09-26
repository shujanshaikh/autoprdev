import { readFile } from "node:fs/promises";
import { z } from "zod";

const requestSchema = z.object({
  event: z.literal("agent_request"), requestId: z.string(), turnId: z.string(), status: z.string(),
  inputTokens: z.number().nullable().optional(), cachedInputTokens: z.number().nullable().optional(),
  outputTokens: z.number().nullable().optional(), cacheWriteTokens: z.number().nullable().optional(),
  apiEquivalentCost: z.object({ total: z.number() }).nullable().optional(),
});
const toolSchema = z.object({
  event: z.literal("agent_tool"), turnId: z.string(), toolCallId: z.string(), toolName: z.string(),
  errorCategory: z.string().nullable(),
});
const taskSchema = z.array(z.object({ taskId: z.string(), turnIds: z.array(z.string()), completed: z.boolean() }));

// Task labels deliberately come from a reviewer, not model finish reasons.
const [logPath, taskPath] = process.argv.slice(2);
if (!logPath || !taskPath) throw new Error("Usage: tsx scripts/analyze-agent-usage.ts events.jsonl tasks.json");
const tasks = taskSchema.parse(JSON.parse(await readFile(taskPath, "utf8")));
const seenTurns = new Set<string>();
for (const task of tasks) for (const turnId of task.turnIds) {
  if (seenTurns.has(turnId)) throw new Error(`Turn assigned to multiple tasks: ${turnId}`);
  seenTurns.add(turnId);
}
const requests = new Map<string, z.infer<typeof requestSchema>>();
const tools = new Map<string, z.infer<typeof toolSchema>>();
for (const line of (await readFile(logPath, "utf8")).split("\n")) {
  if (!line.trim()) continue;
  const value: unknown = JSON.parse(line);
  const request = requestSchema.safeParse(value);
  if (request.success) {
    const existing = requests.get(request.data.requestId);
    if (existing?.status !== "finished") requests.set(request.data.requestId, request.data);
  }
  const tool = toolSchema.safeParse(value);
  if (tool.success) tools.set(`${tool.data.turnId}:${tool.data.toolCallId}`, tool.data);
}
const taskResults = tasks.map((task) => {
  const turns = new Set(task.turnIds);
  const calls = [...requests.values()].filter((request) => turns.has(request.turnId));
  const finished = calls.filter((request) => request.status === "finished");
  const completeCost = calls.length > 0 && calls.every((call) => call.status === "finished" && call.apiEquivalentCost != null);
  const input = finished.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0);
  const cached = finished.reduce((sum, call) => sum + (call.cachedInputTokens ?? 0), 0);
  return {
    ...task, turns: turns.size, requests: calls.length,
    requestsWithoutUsage: calls.length - finished.length,
    apiEquivalentCost: completeCost ? finished.reduce((sum, call) => sum + call.apiEquivalentCost!.total, 0) : null,
    observedInputTokens: input, observedCachedInputTokens: cached,
    observedOutputTokens: finished.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0),
    observedCacheWriteTokens: finished.reduce((sum, call) => sum + (call.cacheWriteTokens ?? 0), 0),
    cacheReadFraction: input > 0 && finished.every((call) => call.cachedInputTokens != null && call.inputTokens != null)
      ? cached / input : null,
  };
});
const toolResults = [...new Set([...tools.values()].map((tool) => tool.toolName))].map((toolName) => {
  const calls = [...tools.values()].filter((tool) => tool.toolName === toolName && seenTurns.has(tool.turnId));
  return { toolName, calls: calls.length,
    shareOfTurns: seenTurns.size ? new Set(calls.map((call) => call.turnId)).size / seenTurns.size : null,
    errorRate: calls.length ? calls.filter((call) => call.errorCategory !== null).length / calls.length : null };
});
const completed = tasks.filter((task) => task.completed).length;
console.log(JSON.stringify({
  tasks: taskResults, tools: toolResults,
  // Include failed-task spend in the numerator; never reward stopping early.
  apiEquivalentCostPerCompletedTask: completed && taskResults.every((task) => task.apiEquivalentCost !== null)
    ? taskResults.reduce((sum, task) => sum + task.apiEquivalentCost!, 0) / completed : null,
  unassignedRequests: [...requests.values()].filter((request) => !seenTurns.has(request.turnId)).length,
}, null, 2));
