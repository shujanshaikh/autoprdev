import type { DaytonaToolsOptions, RunSubAgent } from "@autopr/agent/tools";

/** Builds the same tool policy for task runs and durable chat sessions. */
export function agentToolSettings(settings: {
  computerUseEnabled?: boolean;
  subAgentsEnabled?: boolean;
  demoEnabled?: boolean;
}, runSubAgent: RunSubAgent): DaytonaToolsOptions {
  return {
    computer: settings.computerUseEnabled === false ? false : { recordingEnabled: Boolean(settings.demoEnabled) },
    subAgent: settings.subAgentsEnabled === false ? false : { run: runSubAgent },
  };
}
