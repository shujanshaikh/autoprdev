import type {
  ModelMessage,
  PrepareStepFunction,
  StepResult,
  ToolSet,
} from "ai";

const DEFAULT_REPEATED_FAILURE_LIMIT = 3;
const DEFAULT_REPEATED_RESULT_LIMIT = 5;

export interface AgentToolLoopDetection {
  kind: "repeated_failure" | "repeated_result";
  toolNames: string[];
  repetitions: number;
}

export interface AgentStepControllerOptions {
  prepareStep?: PrepareStepFunction;
  repeatedFailureLimit?: number;
  repeatedResultLimit?: number;
  onToolLoopDetected?: (detection: AgentToolLoopDetection) => void | Promise<void>;
}

export function createAgentStepController(
  options: AgentStepControllerOptions = {},
): PrepareStepFunction {
  let intervened = false;

  return async (input) => {
    const prepared = await options.prepareStep?.(input);
    if (intervened) return prepared;

    const detection = detectRepeatedToolLoop(input.steps, {
      repeatedFailureLimit: options.repeatedFailureLimit,
      repeatedResultLimit: options.repeatedResultLimit,
    });
    if (!detection) return prepared;

    intervened = true;
    await reportToolLoopDetection(options.onToolLoopDetected, detection);
    const messages = prepared?.messages ?? input.messages;

    return {
      ...prepared,
      messages: [...messages, toolLoopNotice(detection)],
      toolChoice: "none",
      activeTools: [],
    };
  };
}

export function detectRepeatedToolLoop(
  steps: Array<StepResult<ToolSet>>,
  options: Pick<AgentStepControllerOptions, "repeatedFailureLimit" | "repeatedResultLimit"> = {},
): AgentToolLoopDetection | undefined {
  const observations = steps.flatMap((step) => {
    if (step.toolCalls.length === 0) return [];
    return [{
      calls: stableStringify(step.toolCalls.map((call) => ({
        toolName: call.toolName,
        input: call.input,
      }))),
      // Tool-call ids are unique per step, so compare only the semantic result.
      results: stableStringify(step.content.map((part) => {
        if (part.type === "tool-result") {
          return { type: part.type, toolName: part.toolName, output: part.output };
        }
        if (part.type === "tool-error") {
          return { type: part.type, toolName: part.toolName, error: part.error };
        }
        return undefined;
      }).filter((result) => result !== undefined)),
      failed: step.content.some((part) => part.type === "tool-error")
        || step.toolResults.some((result) => isFailedToolOutput(result.output)),
      toolNames: [...new Set(step.toolCalls.map((call) => call.toolName))],
    }];
  });
  const latest = observations.at(-1);
  if (!latest) return undefined;

  const failureLimit = normalizeLimit(options.repeatedFailureLimit, DEFAULT_REPEATED_FAILURE_LIMIT);
  const failedTail = observations.slice(-failureLimit);
  if (
    failedTail.length === failureLimit
    && failedTail.every((observation) => observation.failed && observation.calls === latest.calls)
  ) {
    return {
      kind: "repeated_failure",
      toolNames: latest.toolNames,
      repetitions: failureLimit,
    };
  }

  const resultLimit = normalizeLimit(options.repeatedResultLimit, DEFAULT_REPEATED_RESULT_LIMIT);
  const unchangedTail = observations.slice(-resultLimit);
  if (
    unchangedTail.length === resultLimit
    && unchangedTail.every((observation) =>
      observation.calls === latest.calls && observation.results === latest.results)
  ) {
    return {
      kind: "repeated_result",
      toolNames: latest.toolNames,
      repetitions: resultLimit,
    };
  }

  return undefined;
}

function normalizeLimit(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Math.max(2, Math.floor(value!)) : fallback;
}

function isFailedToolOutput(output: unknown): boolean {
  if (!isRecord(output)) return false;
  if (typeof output.error === "string" && output.error.trim()) return true;

  const details = isRecord(output.details) ? output.details : output;
  return details.timedOut === true
    || typeof details.exitCode === "number" && details.exitCode !== 0;
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(normalizeJson(value, seen)) ?? "undefined";
}

function normalizeJson(value: unknown, seen: WeakSet<object>): unknown {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => normalizeJson(item, seen));
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeJson(item, seen)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolLoopNotice(detection: AgentToolLoopDetection): ModelMessage {
  const behavior = detection.kind === "repeated_failure"
    ? "failed"
    : "returned the same result";
  return {
    role: "user",
    content:
      `<harness_notice type="repeated_tool_loop">The same ${detection.toolNames.join(", ")} tool call ` +
      `${behavior} ${detection.repetitions} times without progress. Tool use is disabled for this step. ` +
      "Give the user a concise status, the evidence-backed blocker, and the smallest useful next action. " +
      "Do not claim the task succeeded.</harness_notice>",
  };
}

async function reportToolLoopDetection(
  listener: AgentStepControllerOptions["onToolLoopDetected"],
  detection: AgentToolLoopDetection,
) {
  if (!listener) return;
  try {
    await listener(detection);
  } catch (error) {
    console.error("Agent tool-loop listener failed.", error);
  }
}
