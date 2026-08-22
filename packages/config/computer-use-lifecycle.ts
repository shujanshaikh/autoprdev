export const COMPUTER_USE_PROCESS_NAMES = ["xvfb", "xfce4", "x11vnc", "novnc"] as const;

export type ComputerUseProcessName = (typeof COMPUTER_USE_PROCESS_NAMES)[number];

export type ComputerUseLifecycle = {
  start(): Promise<unknown>;
  getStatus(): Promise<unknown>;
  getProcessStatus?(processName: string): Promise<unknown>;
  restartProcess?(processName: string): Promise<unknown>;
  getProcessLogs?(processName: string): Promise<unknown>;
  getProcessErrors?(processName: string): Promise<unknown>;
};

export type EnsureComputerUseReadyOptions = {
  cacheMs?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

export type RecoverComputerUseStreamOptions = Pick<
  EnsureComputerUseReadyOptions,
  "pollIntervalMs" | "timeoutMs"
> & {
  probePort?: (port: number) => Promise<boolean>;
};

type ProcessSnapshot = {
  processName: ComputerUseProcessName;
  running?: boolean;
  status?: string;
  error?: string;
};

type ComputerUseSnapshot = {
  status?: string;
  processes: ProcessSnapshot[];
};

const DEFAULT_CACHE_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_DIAGNOSTIC_LENGTH = 400;
const VNC_SERVER_PORT = 5_901;
const NOVNC_SERVER_PORT = 6_080;
const readyUntil = new WeakMap<object, number>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseField(value: unknown, field: string): unknown {
  return isRecord(value) ? value[field] : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizedStatus(value: unknown): string | undefined {
  const raw = typeof value === "string" ? value : responseField(value, "status");
  return typeof raw === "string" ? raw.trim().toLowerCase() : undefined;
}

function compactDiagnostic(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  let raw: string;
  try {
    raw = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  } catch {
    raw = String(value);
  }
  const normalized = raw.trim().replace(/\s+/g, " ");
  return normalized.length > MAX_DIAGNOSTIC_LENGTH
    ? `${normalized.slice(0, MAX_DIAGNOSTIC_LENGTH)}...`
    : normalized;
}

async function inspectProcesses(computerUse: ComputerUseLifecycle): Promise<ProcessSnapshot[]> {
  if (!computerUse.getProcessStatus) return [];

  return Promise.all(COMPUTER_USE_PROCESS_NAMES.map(async (processName): Promise<ProcessSnapshot> => {
    try {
      const response = await computerUse.getProcessStatus?.(processName);
      const running = responseField(response, "running");
      const status = responseField(response, "status");
      return {
        processName,
        running: typeof running === "boolean" ? running : undefined,
        status: typeof status === "string" ? status : undefined,
      };
    } catch (error) {
      return { processName, error: errorMessage(error) };
    }
  }));
}

async function inspectComputerUse(computerUse: ComputerUseLifecycle): Promise<ComputerUseSnapshot> {
  const [status, processes] = await Promise.all([
    computerUse.getStatus().then(normalizedStatus).catch(() => undefined),
    inspectProcesses(computerUse),
  ]);
  return { status, processes };
}

function coreProcessesReady(snapshot: ComputerUseSnapshot): boolean {
  return snapshot.processes.length === COMPUTER_USE_PROCESS_NAMES.length
    && snapshot.processes.every((process) => process.running === true);
}

function desktopReady(snapshot: ComputerUseSnapshot): boolean {
  // Daytona's aggregate state can briefly remain `active` after one of the
  // supervised processes exits. An explicit per-process failure must win over
  // that stale aggregate state so the failed service can be restarted.
  if (snapshot.processes.some((process) => process.running === false)) return false;
  return coreProcessesReady(snapshot) || snapshot.status === "active";
}

function failedProcesses(snapshot: ComputerUseSnapshot): ComputerUseProcessName[] {
  return snapshot.processes
    .filter((process) => process.running === false)
    .map((process) => process.processName);
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function waitForReady(
  computerUse: ComputerUseLifecycle,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<ComputerUseSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let snapshot = await inspectComputerUse(computerUse);

  while (!desktopReady(snapshot) && Date.now() < deadline) {
    await delay(pollIntervalMs);
    snapshot = await inspectComputerUse(computerUse);
  }

  return snapshot;
}

async function waitForPort(
  probePort: (port: number) => Promise<boolean>,
  port: number,
  deadline: number,
  pollIntervalMs: number,
): Promise<boolean> {
  while (true) {
    try {
      if (await probePort(port)) return true;
    } catch {
      // The next probe can succeed while Daytona finishes binding the process.
    }

    if (Date.now() >= deadline) return false;
    await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
}

async function processDiagnostic(computerUse: ComputerUseLifecycle, process: ProcessSnapshot): Promise<string> {
  const parts = [
    process.processName,
    process.running === undefined ? undefined : `running=${process.running}`,
    process.status ? `status=${process.status}` : undefined,
    process.error ? `status_error=${compactDiagnostic(process.error)}` : undefined,
  ];

  try {
    const errors = compactDiagnostic(responseField(
      await computerUse.getProcessErrors?.(process.processName),
      "errors",
    ));
    if (errors) parts.push(`errors=${errors}`);
  } catch (error) {
    parts.push(`errors_error=${compactDiagnostic(errorMessage(error))}`);
  }

  if (!parts.some((part) => part?.startsWith("errors="))) {
    try {
      const logs = compactDiagnostic(responseField(
        await computerUse.getProcessLogs?.(process.processName),
        "logs",
      ));
      if (logs) parts.push(`logs=${logs}`);
    } catch (error) {
      parts.push(`logs_error=${compactDiagnostic(errorMessage(error))}`);
    }
  }

  return parts.filter(Boolean).join(" ");
}

async function readinessError(
  computerUse: ComputerUseLifecycle,
  snapshot: ComputerUseSnapshot,
  errors: unknown[],
): Promise<Error> {
  const attempts = Array.from(new Set(errors.map(errorMessage).filter(Boolean))).slice(0, 4);
  const processes = await Promise.all(snapshot.processes.map((process) => processDiagnostic(computerUse, process)));
  return new Error([
    "Daytona desktop did not become ready without disrupting the active session.",
    snapshot.status ? `status=${snapshot.status}` : "status=unknown",
    attempts.length > 0 ? `attempts: ${attempts.join(" | ")}` : undefined,
    processes.length > 0 ? `processes: ${processes.join("; ")}` : undefined,
  ].filter(Boolean).join(" "));
}

async function restartFailedProcesses(
  computerUse: ComputerUseLifecycle,
  processNames: ComputerUseProcessName[],
  errors: unknown[],
): Promise<void> {
  if (processNames.length === 0) return;
  if (!computerUse.restartProcess) {
    errors.push(new Error(`Cannot restart failed desktop processes: ${processNames.join(", ")}.`));
    return;
  }

  for (const processName of processNames) {
    try {
      await computerUse.restartProcess(processName);
    } catch (error) {
      errors.push(new Error(`restart ${processName}: ${errorMessage(error)}`));
    }
  }
}

/**
 * Ensures Daytona's core desktop services are usable without stopping the whole
 * stack. Per-process health takes precedence over Daytona's aggregate state,
 * and recovery is limited to services explicitly reported as down.
 */
export async function ensureComputerUseReady(
  computerUse: ComputerUseLifecycle,
  options: EnsureComputerUseReadyOptions = {},
): Promise<void> {
  const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
  if ((readyUntil.get(computerUse) ?? 0) > Date.now()) return;

  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const errors: unknown[] = [];
  let snapshot = await inspectComputerUse(computerUse);

  if (!desktopReady(snapshot)) {
    const failed = failedProcesses(snapshot);
    if (failed.length > 0) {
      await restartFailedProcesses(computerUse, failed, errors);
    } else {
      try {
        // Daytona start is idempotent for services that are already running.
        // Unlike stop/start, it does not intentionally drop healthy VNC clients.
        await computerUse.start();
      } catch (error) {
        errors.push(error);
      }
    }

    snapshot = await waitForReady(computerUse, timeoutMs, pollIntervalMs);
  }

  if (!desktopReady(snapshot)) throw await readinessError(computerUse, snapshot, errors);
  if (cacheMs > 0) readyUntil.set(computerUse, Date.now() + cacheMs);
}

/**
 * Replaces only the two VNC transport processes after a client proves that a
 * nominally running stream cannot reach its downstream server. The desktop
 * and its applications stay alive while x11vnc and noVNC are reattached.
 */
export async function recoverComputerUseStream(
  computerUse: ComputerUseLifecycle,
  options: RecoverComputerUseStreamOptions = {},
): Promise<void> {
  invalidateComputerUseReadiness(computerUse);
  if (!computerUse.restartProcess) {
    throw new Error("Daytona cannot restart the failed desktop stream processes.");
  }

  const errors: unknown[] = [];
  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const deadline = Date.now() + timeoutMs;

  await restartFailedProcesses(computerUse, ["x11vnc"], errors);
  if (
    options.probePort
    && !await waitForPort(options.probePort, VNC_SERVER_PORT, deadline, pollIntervalMs)
  ) {
    errors.push(new Error(`x11vnc did not accept connections on port ${VNC_SERVER_PORT}.`));
  } else {
    // noVNC must start after x11vnc is accepting downstream connections. A
    // running process flag alone can arrive before either socket is bound.
    await restartFailedProcesses(computerUse, ["novnc"], errors);
    if (
      options.probePort
      && !await waitForPort(options.probePort, NOVNC_SERVER_PORT, deadline, pollIntervalMs)
    ) {
      errors.push(new Error(`noVNC did not accept connections on port ${NOVNC_SERVER_PORT}.`));
    }
  }

  const snapshot = options.probePort
    ? await inspectComputerUse(computerUse)
    : await waitForReady(computerUse, timeoutMs, pollIntervalMs);
  if (errors.length > 0 || !desktopReady(snapshot)) {
    throw await readinessError(computerUse, snapshot, errors);
  }
}

export function invalidateComputerUseReadiness(computerUse: ComputerUseLifecycle): void {
  readyUntil.delete(computerUse);
}
