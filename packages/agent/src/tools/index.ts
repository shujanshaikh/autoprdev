import type { ToolSet } from "ai";

import type { SandboxSessionOptions } from "../sandbox";
import {
  createDaytonaTools,
  type DaytonaToolsOptions,
} from "./providers/daytona";
import {
  createE2BTools,
  type E2BToolsOptions,
} from "./providers/e2b";

export function createSandboxTools(
  sandboxOptions: SandboxSessionOptions,
  options: DaytonaToolsOptions | E2BToolsOptions = {},
): SandboxTools {
  return sandboxOptions.provider === "e2b"
    ? createE2BTools(sandboxOptions, options)
    : createDaytonaTools(sandboxOptions, options);
}

export type SandboxTools = ToolSet;
export type DaytonaTools = SandboxTools;
export { createDaytonaTools, createE2BTools };
export type { DaytonaToolsOptions, E2BToolsOptions };
export type { CuaComputerToolOptions } from "./computer";
export type {
  RunSubAgent,
  SubAgentInput,
  SubAgentRunResult,
  SubAgentTask,
  SubAgentToolOptions,
} from "./sub-agent";
