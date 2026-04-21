import { createDaytonaBashTool } from "./bash";
import { createDaytonaEditTool } from "./edit";
import { createDaytonaFindTool } from "./find";
import { createDaytonaGrepTool } from "./grep";
import { createDaytonaLsTool } from "./ls";
import { createDaytonaReadTool } from "./read";
import { createDaytonaSandboxInfoTool } from "./sandbox-info";
import { createDaytonaWriteTool } from "./write";
import type { SandboxSessionOptions } from "../sandbox";

export function createDaytonaTools(sandboxOptions: SandboxSessionOptions) {
  return {
    sandboxInfo: createDaytonaSandboxInfoTool(sandboxOptions),
    read: createDaytonaReadTool(sandboxOptions),
    ls: createDaytonaLsTool(sandboxOptions),
    find: createDaytonaFindTool(sandboxOptions),
    grep: createDaytonaGrepTool(sandboxOptions),
    edit: createDaytonaEditTool(sandboxOptions),
    write: createDaytonaWriteTool(sandboxOptions),
    bash: createDaytonaBashTool(sandboxOptions),
  };
}

export type DaytonaTools = ReturnType<typeof createDaytonaTools>;
