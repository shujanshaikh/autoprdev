import { createDaytonaBashTool } from "./bash";
import { createDaytonaComputerTool, type DaytonaComputerToolOptions } from "./computer";
import { createDaytonaEditTool } from "./edit";
import { createDaytonaFindTool } from "./find";
import { createDaytonaGrepTool } from "./grep";
import { createDaytonaLsTool } from "./ls";
import { createDaytonaReadTool } from "./read";
import { createDaytonaSandboxInfoTool } from "./sandbox-info";
import { createDaytonaWriteTool } from "./write";
import type { SandboxSessionOptions } from "../sandbox";

export interface DaytonaToolsOptions {
  computer?: false | DaytonaComputerToolOptions;
}

export function createDaytonaTools(
  sandboxOptions: SandboxSessionOptions,
  options: DaytonaToolsOptions = {},
) {
  const tools = {
    sandboxInfo: createDaytonaSandboxInfoTool(sandboxOptions),
    read: createDaytonaReadTool(sandboxOptions),
    ls: createDaytonaLsTool(sandboxOptions),
    find: createDaytonaFindTool(sandboxOptions),
    grep: createDaytonaGrepTool(sandboxOptions),
    edit: createDaytonaEditTool(sandboxOptions),
    write: createDaytonaWriteTool(sandboxOptions),
    bash: createDaytonaBashTool(sandboxOptions),
  };

  if (!options.computer) {
    return tools;
  }

  return {
    ...tools,
    computer: createDaytonaComputerTool(sandboxOptions, options.computer),
  };
}

export type DaytonaTools = ReturnType<typeof createDaytonaTools>;
export type { DaytonaComputerToolOptions };
