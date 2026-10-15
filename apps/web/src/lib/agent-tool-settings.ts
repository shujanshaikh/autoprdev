import { parseHarnessExperiments, type HarnessExperiment } from "@autopr/agent";
import type { DaytonaToolsOptions, RunSubAgent } from "@autopr/agent/tools";

/** Reads the opt-in harness experiments enabled for this worker. */
export function agentHarnessExperiments() {
  return parseHarnessExperiments(process.env.AUTOPR_HARNESS_EXPERIMENTS);
}

/** Builds the same tool policy for task runs and durable chat sessions. */
export function agentToolSettings(settings: {
  computerUseEnabled?: boolean;
  subAgentsEnabled?: boolean;
  demoEnabled?: boolean;
}, runSubAgent: RunSubAgent, experiments: readonly HarnessExperiment[] = []): DaytonaToolsOptions {
  return {
    computer: settings.computerUseEnabled === false ? false : { recordingEnabled: Boolean(settings.demoEnabled) },
    subAgent: settings.subAgentsEnabled === false ? false : { run: runSubAgent },
    compactOutput: experiments.includes("compact-tool-output"),
  };
}
