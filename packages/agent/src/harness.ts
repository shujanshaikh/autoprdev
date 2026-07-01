import { buildSandboxAgentSystemPrompt } from "./system-prompt";
import { loadSandboxProjectInstructions } from "./project-instructions";
import { createDaytonaTools, type DaytonaComputerToolOptions, type DaytonaTools } from "./tools";
import { prepareDaytonaSandbox, type PreparedSandbox } from "./steps";
import type { SandboxSessionOptions } from "./sandbox";

export type CodingHarnessPhase = "idle" | "preparing" | "running" | "settling";

export interface CodingHarnessContext {
  sandbox: PreparedSandbox;
  tools: DaytonaTools;
  toolNames: string[];
  instructionFiles: Array<{ path: string; content: string }>;
  unavailableSelectedTools: string[];
  instructions: string;
}

export type CodingHarnessEvent =
  | { type: "phase_change"; phase: CodingHarnessPhase; previousPhase: CodingHarnessPhase }
  | { type: "sandbox_prepared"; context: CodingHarnessContext }
  | { type: "run_start"; context: CodingHarnessContext }
  | { type: "run_finish"; context: CodingHarnessContext }
  | { type: "run_error"; context?: CodingHarnessContext; error: unknown };

export type CodingHarnessListener = (event: CodingHarnessEvent) => void | Promise<void>;

export interface CodingHarnessListenerError {
  event: CodingHarnessEvent;
  error: unknown;
}

export type CodingHarnessListenerErrorHandler = (failure: CodingHarnessListenerError) => void | Promise<void>;

export interface CodingHarnessOptions extends SandboxSessionOptions {
  appendSystemPrompt?: string;
  modelId?: string;
  selectedTools?: string[];
  includeProjectInstructions?: boolean;
  projectInstructionFilenames?: string[];
  projectInstructionMaxBytes?: number;
  computer?: false | DaytonaComputerToolOptions;
  onListenerError?: CodingHarnessListenerErrorHandler;
}

export class CodingHarnessBusyError extends Error {
  readonly code = "busy";

  constructor(phase: CodingHarnessPhase) {
    super(`Coding harness is busy (${phase})`);
    this.name = "CodingHarnessBusyError";
  }
}

/**
 * Small orchestration harness for Daytona-backed coding agents.
 *
 * Inspired by Pi's harness split, this class keeps sandbox/tool/prompt preparation
 * deterministic and observable while leaving the concrete model runtime to the app.
 */
export class CodingHarness {
  private phase: CodingHarnessPhase = "idle";
  private prepared?: CodingHarnessContext;
  private readonly listeners = new Set<CodingHarnessListener>();

  constructor(private readonly options: CodingHarnessOptions) {}

  getPhase(): CodingHarnessPhase {
    return this.phase;
  }

  getContext(): CodingHarnessContext | undefined {
    return this.prepared;
  }

  on(listener: CodingHarnessListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async prepare(): Promise<CodingHarnessContext> {
    if (this.prepared) {
      return this.prepared;
    }
    this.assertIdle();
    await this.setPhase("preparing");

    try {
      const sandbox = await prepareDaytonaSandbox(this.options);
      const tools = createDaytonaTools(this.options, {
        computer: this.options.computer,
      });
      const toolSelection = selectTools(tools, this.options.selectedTools);
      const instructionFiles = this.options.includeProjectInstructions === false
        ? []
        : await loadSandboxProjectInstructions(this.options, {
            cwd: sandbox.workDir,
            projectRoot: sandbox.workDir,
            filenames: this.options.projectInstructionFilenames,
            maxBytes: this.options.projectInstructionMaxBytes,
          });
      const instructions = buildSandboxAgentSystemPrompt({
        cwd: sandbox.workDir,
        sandboxId: sandbox.sandboxId,
        sandboxName: sandbox.sandboxName,
        snapshot: sandbox.snapshot,
        modelId: this.options.modelId,
        selectedTools: toolSelection.toolNames,
        contextFiles: instructionFiles,
        appendSystemPrompt: this.options.appendSystemPrompt,
      });

      const context = {
        sandbox,
        tools: toolSelection.tools,
        toolNames: toolSelection.toolNames,
        instructionFiles,
        unavailableSelectedTools: toolSelection.unavailableToolNames,
        instructions,
      };
      this.prepared = context;
      await this.emit({ type: "sandbox_prepared", context });
      return context;
    } catch (error) {
      await this.emit({ type: "run_error", error });
      throw error;
    } finally {
      await this.setPhase("idle");
    }
  }

  async run<T>(execute: (context: CodingHarnessContext) => Promise<T>): Promise<T> {
    const context = await this.prepare();
    this.assertIdle();
    await this.setPhase("running");
    await this.emit({ type: "run_start", context });

    try {
      const result = await execute(context);
      await this.setPhase("settling");
      await this.emit({ type: "run_finish", context });
      return result;
    } catch (error) {
      await this.emit({ type: "run_error", context, error });
      throw error;
    } finally {
      await this.setPhase("idle");
    }
  }

  private assertIdle() {
    if (this.phase !== "idle") {
      throw new CodingHarnessBusyError(this.phase);
    }
  }

  private async setPhase(phase: CodingHarnessPhase) {
    if (this.phase === phase) {
      return;
    }
    const previousPhase = this.phase;
    this.phase = phase;
    await this.emit({ type: "phase_change", phase, previousPhase });
  }

  private async emit(event: CodingHarnessEvent) {
    const results = await Promise.allSettled(
      [...this.listeners].map((listener) => Promise.resolve().then(() => listener(event))),
    );

    for (const result of results) {
      if (result.status === "rejected") {
        await this.reportListenerError(event, result.reason);
      }
    }
  }

  private async reportListenerError(event: CodingHarnessEvent, error: unknown) {
    const label = describeCodingHarnessEvent(event);
    const handler = this.options.onListenerError;

    if (!handler) {
      console.error(`CodingHarness listener failed while handling ${label}.`, error);
      return;
    }

    try {
      await handler({ event, error });
    } catch (handlerError) {
      console.error(`CodingHarness listener error handler failed while handling ${label}.`, handlerError);
      console.error(`Original CodingHarness listener failure while handling ${label}.`, error);
    }
  }
}

function describeCodingHarnessEvent(event: CodingHarnessEvent): string {
  if (event.type === "phase_change") {
    return `${event.type}:${event.previousPhase}->${event.phase}`;
  }

  return event.type;
}

function selectTools(
  tools: DaytonaTools,
  selectedTools: string[] | undefined,
): { tools: DaytonaTools; toolNames: string[]; unavailableToolNames: string[] } {
  const availableToolNames = Object.keys(tools);
  const requestedToolNames = selectedTools ? dedupeToolNames(selectedTools) : availableToolNames;
  const availableToolNameSet = new Set(availableToolNames);
  const toolNames = requestedToolNames.filter((toolName) => availableToolNameSet.has(toolName));
  const unavailableToolNames = requestedToolNames.filter((toolName) => !availableToolNameSet.has(toolName));

  const selectedToolSet = new Set(toolNames);
  const selectedToolEntries = Object.entries(tools).filter(([toolName]) => selectedToolSet.has(toolName));

  return {
    tools: Object.fromEntries(selectedToolEntries) as DaytonaTools,
    toolNames,
    unavailableToolNames,
  };
}

function dedupeToolNames(toolNames: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const toolName of toolNames) {
    const normalized = toolName.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
}
