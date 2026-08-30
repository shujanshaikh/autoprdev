import { createDaytonaBashTool } from "./bash";
import { createCuaComputerTool, type CuaComputerToolOptions } from "./computer";
import { createDaytonaEditTool } from "./edit";
import { createDaytonaFindTool } from "./find";
import { createDaytonaGrepTool } from "./grep";
import { createDaytonaLsTool } from "./ls";
import { createDaytonaProcessTool } from "./process";
import { createDaytonaReadTool } from "./read";
import { createDaytonaSandboxInfoTool } from "./sandbox-info";
import { createSubAgentTool, type SubAgentToolOptions } from "./sub-agent";
import { createDaytonaWriteTool } from "./write";
import { createBackgroundProcessScope } from "./background-process-scope";
import type { ToolSet } from "ai";
import type { SandboxSessionOptions } from "../sandbox";

export interface DaytonaToolsOptions {
  computer?: false | CuaComputerToolOptions;
  subAgent?: false | SubAgentToolOptions;
}

export function createDaytonaTools(
  sandboxOptions: SandboxSessionOptions,
  options: DaytonaToolsOptions = {},
): DaytonaTools {
  const backgroundProcesses = createBackgroundProcessScope();
  const tools: DaytonaTools = {
    sandboxInfo: createDaytonaSandboxInfoTool(sandboxOptions),
    read: createDaytonaReadTool(sandboxOptions),
    ls: createDaytonaLsTool(sandboxOptions),
    find: createDaytonaFindTool(sandboxOptions),
    grep: createDaytonaGrepTool(sandboxOptions),
    edit: createDaytonaEditTool(sandboxOptions),
    write: createDaytonaWriteTool(sandboxOptions),
    bash: createDaytonaBashTool(sandboxOptions, backgroundProcesses),
    process: createDaytonaProcessTool(sandboxOptions, backgroundProcesses),
  };

  if (options.subAgent) {
    tools["sub-agent"] = createSubAgentTool(options.subAgent);
  }

  if (options.computer) {
    tools.computer = createCuaComputerTool(sandboxOptions, options.computer);
  }

  return tools;
}

export type DaytonaTools = ToolSet;
export type { CuaComputerToolOptions };
export type {
  RunSubAgent,
  SubAgentInput,
  SubAgentRunResult,
  SubAgentTask,
  SubAgentToolOptions,
} from "./sub-agent";
