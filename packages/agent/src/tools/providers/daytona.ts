import type { ToolSet } from "ai";

import type { SandboxSessionOptions } from "../../sandbox";
import { createBackgroundProcessScope } from "../background-process-scope";
import { createDaytonaBashTool } from "../bash";
import { createCuaComputerTool, type CuaComputerToolOptions } from "../computer";
import { createDaytonaEditTool } from "../edit";
import { createDaytonaFindTool } from "../find";
import { createDaytonaGrepTool } from "../grep";
import { createDaytonaLsTool } from "../ls";
import { createDaytonaProcessTool } from "../process";
import { createDaytonaReadTool } from "../read";
import { createDaytonaSandboxInfoTool } from "../sandbox-info";
import { createSubAgentTool, type SubAgentToolOptions } from "../sub-agent";
import { createDaytonaWriteTool } from "../write";

export interface DaytonaToolsOptions {
  computer?: false | CuaComputerToolOptions;
  subAgent?: false | SubAgentToolOptions;
}

/** Builds the existing Daytona tool set without changing its behavior. */
export function createDaytonaTools(
  sandboxOptions: SandboxSessionOptions,
  options: DaytonaToolsOptions = {},
): ToolSet {
  const resolvedOptions = { ...sandboxOptions, provider: "daytona" as const };
  const backgroundProcesses = createBackgroundProcessScope();
  const tools: ToolSet = {
    sandboxInfo: createDaytonaSandboxInfoTool(resolvedOptions),
    read: createDaytonaReadTool(resolvedOptions),
    ls: createDaytonaLsTool(resolvedOptions),
    find: createDaytonaFindTool(resolvedOptions),
    grep: createDaytonaGrepTool(resolvedOptions),
    edit: createDaytonaEditTool(resolvedOptions),
    write: createDaytonaWriteTool(resolvedOptions),
    bash: createDaytonaBashTool(resolvedOptions, backgroundProcesses),
    process: createDaytonaProcessTool(resolvedOptions, backgroundProcesses),
  };

  if (options.subAgent) tools["sub-agent"] = createSubAgentTool(options.subAgent);
  if (options.computer) tools.computer = createCuaComputerTool(resolvedOptions, options.computer);
  return tools;
}
