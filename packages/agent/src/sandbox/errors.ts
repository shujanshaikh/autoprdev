export class SandboxRuntimeNotStartedError extends Error {
  readonly code = "SANDBOX_RUNTIME_NOT_STARTED";

  constructor(readonly state?: string) {
    super(`The sandbox is not running${state ? ` (state: ${state})` : ""}.`);
    this.name = "SandboxRuntimeNotStartedError";
  }
}
