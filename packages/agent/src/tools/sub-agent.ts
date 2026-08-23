import { tool } from "ai";
import { z } from "zod";

import { toTextModelOutput, truncateToolOutput } from "./format";

const DEFAULT_MAX_CONCURRENT_SUB_AGENTS = 4;

const subAgentInputSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe("A short, specific label for the delegated task."),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(50_000)
    .describe(
      "A self-contained task prompt. Include the relevant context, expected result, and an explicit non-overlapping file scope when edits are allowed.",
    ),
});

export type SubAgentInput = z.infer<typeof subAgentInputSchema>;

export interface SubAgentTask extends SubAgentInput {
  abortSignal?: AbortSignal;
}

export interface SubAgentRunResult {
  output: string;
  stepCount: number;
}

export type RunSubAgent = (task: SubAgentTask) => Promise<SubAgentRunResult>;

export interface SubAgentToolOptions {
  run: RunSubAgent;
  maxConcurrent?: number;
}

export function createSubAgentTool(options: SubAgentToolOptions) {
  const requestedMaxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_SUB_AGENTS;
  const maxConcurrent = Number.isFinite(requestedMaxConcurrent)
    ? Math.max(1, Math.floor(requestedMaxConcurrent))
    : DEFAULT_MAX_CONCURRENT_SUB_AGENTS;
  let activeCount = 0;

  return tool({
    title: "sub-agent",
    description:
      `Delegate one concrete, bounded subtask to an isolated coding agent and wait for its result. ` +
      `The sub-agent shares the Daytona workspace, uses the configured child model, receives only the supplied prompt, and cannot delegate again. ` +
      `Issue separate sub-agent calls in parallel for independent tasks with disjoint write scopes; at most ${maxConcurrent} can run concurrently. ` +
      "Do not delegate the immediate blocking task, duplicate work, or send overlapping edits.",
    inputSchema: subAgentInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: async (input, { abortSignal }) => {
      if (activeCount >= maxConcurrent) {
        throw new Error(
          `sub-agent supports at most ${maxConcurrent} concurrent tasks in one agent run.`,
        );
      }

      activeCount += 1;
      try {
        const result = await options.run({ ...input, abortSignal });
        const output = truncateToolOutput(result.output, { direction: "tail" });

        return {
          content:
            `Sub-agent completed: ${input.description}\n\n` +
            (output.text || "The sub-agent completed without a text response."),
          details: {
            description: input.description,
            status: "completed" as const,
            stepCount: result.stepCount,
            output: output.text,
            outputStats: {
              totalBytes: output.totalBytes,
              totalLines: output.totalLines,
              outputBytes: output.outputBytes,
              outputLines: output.outputLines,
              truncatedBy: output.truncatedBy,
            },
            truncated: output.truncated,
          },
        };
      } finally {
        activeCount -= 1;
      }
    },
  });
}
