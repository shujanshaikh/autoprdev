import {
  applyAgenticCache,
  CodingHarness,
  createAgentStepController,
  type RunSubAgent,
  type SandboxSessionOptions,
  withSandboxAgentProjectContext,
} from "@autopr/agent";
import { generateText, stepCountIs, type LanguageModel } from "ai";

import { createAgentContextCompactor } from "#/lib/agent-context-compaction";
import { agentProviderOptions, agentSystemPrompt } from "#/lib/agent-auth-runtime-server";
import { getAgentContextLimit } from "#/lib/agent-models";
import type { AssistantUsageStep } from "#/lib/agent-usage";
import type { AgentModelOptions } from "#/lib/trigger-agent-contract";

const MAX_SUB_AGENT_STEPS = 50;

interface AgentSubAgentRunnerOptions {
  sandboxOptions: SandboxSessionOptions;
  model: LanguageModel;
  selectedModel: AgentModelOptions;
  parentAbortSignal?: AbortSignal;
  onUsageStep?: (step: AssistantUsageStep) => void;
}

/** Binds the model-backed runner after the parent harness and model are ready. */
export function createSubAgentBinding() {
  let runner: RunSubAgent | undefined;

  return {
    run: (async (task) => {
      if (!runner) {
        throw new Error("sub-agent was called before the parent agent runtime was ready.");
      }
      return runner(task);
    }) satisfies RunSubAgent,
    bind(nextRunner: RunSubAgent) {
      runner = nextRunner;
    },
  };
}

/** Runs a fresh, non-recursive agent conversation against the parent's sandbox and model. */
export function createAgentSubAgentRunner(options: AgentSubAgentRunnerOptions): RunSubAgent {
  return async ({ description, prompt, abortSignal }) => {
    const signal = combineAbortSignals(options.parentAbortSignal, abortSignal);
    const harness = new CodingHarness({
      ...options.sandboxOptions,
      computer: false,
      modelId: options.selectedModel.modelId,
      modelProviderName:
        options.selectedModel.provider === "xai"
          ? "SuperGrok subscription"
          : "ChatGPT / Codex subscription",
      appendSystemPrompt: [
        "You are a focused sub-agent working inside the parent agent's Daytona sandbox.",
        `Assigned task: ${description}`,
        "Complete only the supplied task. Other agents may be working in the same repository, so preserve unrelated changes and stay within any stated file scope.",
        "Do not leave background processes running. Terminate any process you start before responding.",
        "You cannot delegate further. Return a concise result with changed files, validation, and any blocker the parent must handle.",
      ].join("\n"),
    });

    return harness.run(async ({ instructions, repositoryContext, tools }) => {
      let stepCount = 0;
      const result = await generateText({
        model: options.model,
        system: agentSystemPrompt(options.selectedModel, instructions),
        messages: applyAgenticCache(
          withSandboxAgentProjectContext(
            [{ role: "user", content: prompt }],
            repositoryContext,
          ),
        ),
        tools,
        toolChoice: "auto",
        stopWhen: stepCountIs(MAX_SUB_AGENT_STEPS),
        maxRetries: 2,
        abortSignal: signal,
        prepareStep: createAgentStepController({
          prepareStep: createAgentContextCompactor({
            contextWindow: getAgentContextLimit(options.selectedModel),
            systemPrompt: instructions,
            abortSignal: signal,
          }),
        }),
        onStepFinish: (step) => {
          stepCount += 1;
          options.onUsageStep?.(step);
        },
        providerOptions: agentProviderOptions(options.selectedModel, instructions),
      });

      return {
        output: result.text.trim() || "The sub-agent completed without a text response.",
        stepCount,
      };
    });
  };
}

function combineAbortSignals(...signals: Array<AbortSignal | undefined>) {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 0) return undefined;
  if (activeSignals.length === 1) return activeSignals[0];
  return AbortSignal.any(activeSignals);
}
