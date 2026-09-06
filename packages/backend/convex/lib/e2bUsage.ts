import { z } from "zod";

const timestamp = z.iso.datetime({ offset: true }).transform((value) => Date.parse(value));
const executionSchema = z.object({
  started_at: timestamp,
  vcpu_count: z.number().positive(),
  memory_mb: z.number().positive(),
  execution_time: z.number().nonnegative(),
});
const eventData = z.object({ execution: executionSchema.optional() }).nullish();
const eventSchema = z.object({
  id: z.string(),
  type: z.string(),
  timestamp,
  sandbox_id: z.string().optional(),
  sandboxId: z.string().optional(),
  sandbox_execution_id: z.string().optional(),
  sandboxExecutionId: z.string().optional(),
  event_data: eventData,
  eventData,
}).transform((event) => {
  const execution = (event.event_data ?? event.eventData)?.execution;
  return {
    id: event.id,
    type: event.type,
    timestamp: event.timestamp,
    sandboxId: event.sandbox_id ?? event.sandboxId,
    executionId: event.sandbox_execution_id ?? event.sandboxExecutionId,
    ...(execution ? { execution } : {}),
  };
}).pipe(z.object({
  id: z.string(),
  type: z.string(),
  timestamp: z.number(),
  sandboxId: z.string(),
  executionId: z.string(),
  execution: z.object({
    started_at: z.number(),
    vcpu_count: z.number(),
    memory_mb: z.number(),
    execution_time: z.number(),
  }).optional(),
}));

export type E2BUsageEvent = z.infer<typeof eventSchema>;
export type E2BExecutionUsage = {
  executionId: string;
  startedAt: number;
  stoppedAt?: number;
  runningMs?: number;
  cpuCount?: number;
  memoryMB?: number;
  providerMeasured?: boolean;
};

// The events API is separate from the sandbox SDK's OpenAPI specification.
// https://docs.e2b.dev/sandbox/lifecycle-events-api
export async function fetchE2BUsageEvents(sandboxId: string) {
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) throw new Error("E2B_API_KEY is required for sandbox usage tracking.");
  const baseUrl = process.env.E2B_API_URL ?? `https://api.${process.env.E2B_DOMAIN ?? "e2b.app"}`;
  const events: E2BUsageEvent[] = [];
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const url = new URL(`events/sandboxes/${encodeURIComponent(sandboxId)}`, `${baseUrl.replace(/\/$/, "")}/`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("orderAsc", "true");
    for (const type of ["created", "resumed", "paused", "killed"]) {
      url.searchParams.append("types", `sandbox.lifecycle.${type}`);
    }
    const response = await fetch(url, {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`E2B lifecycle request failed (${response.status}).`);
    const payload: unknown = await response.json();
    const page = z.array(eventSchema).parse(payload);
    if (page.some((event) => event.sandboxId !== sandboxId || !event.executionId)) {
      throw new Error("E2B returned an event with an unexpected sandbox or missing execution ID.");
    }
    events.push(...page);
    if (page.length < limit) return events;
  }
}

/** Merge executions by provider ID, so retries and pause-then-kill never add runtime twice. */
export function mergeE2BExecutions(
  existing: E2BExecutionUsage[],
  events: E2BUsageEvent[],
) {
  const executions = new Map<string, E2BExecutionUsage>(existing.map((execution) => [execution.executionId, {
    executionId: execution.executionId,
    startedAt: execution.startedAt,
    stoppedAt: execution.stoppedAt,
    runningMs: execution.runningMs,
    cpuCount: execution.cpuCount,
    memoryMB: execution.memoryMB,
    providerMeasured: execution.providerMeasured,
  }]));
  for (const event of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    const previous = executions.get(event.executionId);
    if (event.type === "sandbox.lifecycle.created" || event.type === "sandbox.lifecycle.resumed") {
      if (!previous) executions.set(event.executionId, {
        executionId: event.executionId,
        startedAt: event.timestamp,
      });
      continue;
    }
    if (event.type !== "sandbox.lifecycle.paused" && event.type !== "sandbox.lifecycle.killed") continue;
    // v2 terminal events include actual runtime in milliseconds and allocated resources.
    // v1 events require a matching start event to estimate the execution duration.
    if (event.execution && (!previous?.providerMeasured || event.timestamp < (previous.stoppedAt ?? Infinity))) {
      executions.set(event.executionId, {
        executionId: event.executionId,
        startedAt: event.execution.started_at,
        stoppedAt: event.timestamp,
        runningMs: event.execution.execution_time,
        cpuCount: event.execution.vcpu_count,
        memoryMB: event.execution.memory_mb,
        providerMeasured: true,
      });
    } else if (previous && !previous.providerMeasured && event.timestamp < (previous.stoppedAt ?? Infinity)) {
      executions.set(event.executionId, {
        ...previous,
        stoppedAt: event.timestamp,
        runningMs: Math.max(0, event.timestamp - previous.startedAt),
      });
    }
  }
  return [...executions.values()];
}
