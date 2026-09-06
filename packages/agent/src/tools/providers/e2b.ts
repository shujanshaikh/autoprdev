import type { ToolSet } from "ai";

import type { SandboxSessionOptions } from "../../sandbox";
import { createBackgroundProcessScope } from "../background-process-scope";
import { createSandboxBashTool } from "../bash";
import { createCuaComputerTool, type CuaComputerToolOptions } from "../computer";
import { createSandboxEditTool } from "../edit";
import { createSandboxFindTool } from "../find";
import { createSandboxGrepTool } from "../grep";
import { createSandboxLsTool } from "../ls";
import { createSandboxProcessTool } from "../process";
import { createSandboxReadTool } from "../read";
import { createSandboxInfoTool } from "../sandbox-info";
import { createSubAgentTool, type SubAgentToolOptions } from "../sub-agent";
import { createSandboxWriteTool } from "../write";

export interface E2BToolsOptions {
  computer?: false | CuaComputerToolOptions;
  subAgent?: false | SubAgentToolOptions;
}

/** Builds tools backed by E2B's SDK adapter and the shared CUA driver. */
export function createE2BTools(
  sandboxOptions: SandboxSessionOptions,
  options: E2BToolsOptions = {},
): ToolSet {
  const resolvedOptions = { ...sandboxOptions, provider: "e2b" as const };
  const backgroundProcesses = createBackgroundProcessScope();
  const tools: ToolSet = {
    sandboxInfo: createSandboxInfoTool(resolvedOptions),
    read: createSandboxReadTool(resolvedOptions),
    ls: createSandboxLsTool(resolvedOptions),
    find: createSandboxFindTool(resolvedOptions),
    grep: createSandboxGrepTool(resolvedOptions),
    edit: createSandboxEditTool(resolvedOptions),
    write: createSandboxWriteTool(resolvedOptions),
    bash: createSandboxBashTool(resolvedOptions, backgroundProcesses),
    process: createSandboxProcessTool(resolvedOptions, backgroundProcesses),
  };

  if (options.subAgent) tools["sub-agent"] = createSubAgentTool(options.subAgent);
  if (options.computer) tools.computer = createCuaComputerTool(resolvedOptions, options.computer);
  return tools;
}
