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
  coordinationKey?: object;
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
const DIAGNOSTIC_TIMEOUT_MS = 1_000;
const MAX_DIAGNOSTIC_LENGTH = 400;
const VNC_SERVER_PORT = 5_901;
const NOVNC_SERVER_PORT = 6_080;
const readyUntil = new WeakMap<object, number>();
const readinessPromises = new WeakMap<object, Promise<void>>();
const streamRecoveryPromises = new WeakMap<object, Promise<void>>();

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

async function beforeDeadline<T>(operation: Promise<T>, deadline: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), Math.max(0, deadline - Date.now()));
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function diagnosticBeforeTimeout<T>(operation: Promise<T>, message: string): Promise<T> {
  return beforeDeadline(operation, Date.now() + DIAGNOSTIC_TIMEOUT_MS, message);
}

async function inspectProcesses(
  computerUse: ComputerUseLifecycle,
  deadline: number,
): Promise<ProcessSnapshot[]> {
  if (!computerUse.getProcessStatus) return [];

  return Promise.all(COMPUTER_USE_PROCESS_NAMES.map(async (processName): Promise<ProcessSnapshot> => {
    try {
      const response = await beforeDeadline(
        Promise.resolve().then(() => computerUse.getProcessStatus!(processName)),
        deadline,
        `Timed out reading ${processName} status.`,
      );
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

async function inspectComputerUse(
  computerUse: ComputerUseLifecycle,
  deadline: number,
): Promise<ComputerUseSnapshot> {
  const [status, processes] = await Promise.all([
    beforeDeadline(
      Promise.resolve().then(() => computerUse.getStatus()),
      deadline,
      "Timed out reading sandbox desktop status.",
    ).then(normalizedStatus).catch(() => undefined),
    inspectProcesses(computerUse, deadline),
  ]);
  return { status, processes };
}

function coreProcessesReady(snapshot: ComputerUseSnapshot): boolean {
  return snapshot.processes.length === COMPUTER_USE_PROCESS_NAMES.length
    && snapshot.processes.every((process) => process.running === true);
}

function desktopReady(snapshot: ComputerUseSnapshot): boolean {
  // A provider's aggregate state can briefly remain `active` after one of the
  // supervised processes exits. An explicit per-process failure must win over
  // that stale aggregate state so the failed service can be restarted.
  if (snapshot.processes.some((process) => process.running === false)) return false;
  return coreProcessesReady(snapshot) || snapshot.status === "active";
}

function transportProcessesReady(snapshot: ComputerUseSnapshot): boolean {
  return ["x11vnc", "novnc"].every((processName) => snapshot.processes.some(
    (process) => process.processName === processName && process.running === true,
  ));
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
  deadline: number,
  pollIntervalMs: number,
  ready: (snapshot: ComputerUseSnapshot) => boolean = desktopReady,
): Promise<ComputerUseSnapshot> {
  let snapshot = await inspectComputerUse(computerUse, deadline);

  while (!ready(snapshot) && Date.now() < deadline) {
    await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    snapshot = await inspectComputerUse(computerUse, deadline);
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
      if (await beforeDeadline(
        Promise.resolve().then(() => probePort(port)),
        deadline,
        `Timed out probing desktop port ${port}.`,
      )) return true;
    } catch {
      // The next probe can succeed while the provider finishes binding the process.
    }

    if (Date.now() >= deadline) return false;
    await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
}

async function probePortOnce(
  probePort: (port: number) => Promise<boolean>,
  port: number,
  deadline: number,
): Promise<boolean> {
  try {
    return await beforeDeadline(
      Promise.resolve().then(() => probePort(port)),
      deadline,
      `Timed out probing desktop port ${port}.`,
    );
  } catch {
    return false;
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
      await diagnosticBeforeTimeout(
        Promise.resolve().then(() => computerUse.getProcessErrors?.(process.processName)),
        `Timed out reading ${process.processName} errors.`,
      ),
      "errors",
    ));
    if (errors) parts.push(`errors=${errors}`);
  } catch (error) {
    parts.push(`errors_error=${compactDiagnostic(errorMessage(error))}`);
  }

  if (!parts.some((part) => part?.startsWith("errors="))) {
    try {
      const logs = compactDiagnostic(responseField(
        await diagnosticBeforeTimeout(
          Promise.resolve().then(() => computerUse.getProcessLogs?.(process.processName)),
          `Timed out reading ${process.processName} logs.`,
        ),
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
    "Sandbox desktop did not become ready without disrupting the active session.",
    snapshot.status ? `status=${snapshot.status}` : "status=unknown",
    attempts.length > 0 ? `attempts: ${attempts.join(" | ")}` : undefined,
    processes.length > 0 ? `processes: ${processes.join("; ")}` : undefined,
  ].filter(Boolean).join(" "));
}

async function restartFailedProcesses(
  computerUse: ComputerUseLifecycle,
  processNames: ComputerUseProcessName[],
  errors: unknown[],
  deadline: number,
): Promise<void> {
  if (processNames.length === 0) return;
  if (!computerUse.restartProcess) {
    errors.push(new Error(`Cannot restart failed desktop processes: ${processNames.join(", ")}.`));
    return;
  }

  for (const processName of processNames) {
    try {
      await beforeDeadline(
        Promise.resolve().then(() => computerUse.restartProcess!(processName)),
        deadline,
        `Timed out restarting ${processName}.`,
      );
    } catch (error) {
      errors.push(new Error(`restart ${processName}: ${errorMessage(error)}`));
    }
  }
}

/**
 * Ensures the sandbox's core desktop services are usable without stopping the
 * whole stack. Per-process health takes precedence over aggregate state,
 * and recovery is limited to services explicitly reported as down.
 */
async function ensureComputerUseReadyUncoalesced(
  computerUse: ComputerUseLifecycle,
  coordinationKey: object,
  options: EnsureComputerUseReadyOptions = {},
): Promise<void> {
  const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
  if ((readyUntil.get(coordinationKey) ?? 0) > Date.now()) return;

  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const deadline = Date.now() + timeoutMs;
  const errors: unknown[] = [];
  let snapshot = await inspectComputerUse(computerUse, deadline);

  if (!desktopReady(snapshot)) {
    const failed = failedProcesses(snapshot);
    if (failed.length > 0) {
      await restartFailedProcesses(computerUse, failed, errors, deadline);
    } else {
      try {
        // Provider start is idempotent for services that are already running.
        // Unlike stop/start, it does not intentionally drop healthy VNC clients.
        await beforeDeadline(
          Promise.resolve().then(() => computerUse.start()),
          deadline,
          "Timed out starting the sandbox desktop.",
        );
      } catch (error) {
        errors.push(error);
      }
    }

    snapshot = await waitForReady(computerUse, deadline, pollIntervalMs);
  }

  if (!desktopReady(snapshot)) throw await readinessError(computerUse, snapshot, errors);
  if (cacheMs > 0) readyUntil.set(coordinationKey, Date.now() + cacheMs);
}

export async function ensureComputerUseReady(
  computerUse: ComputerUseLifecycle,
  options: EnsureComputerUseReadyOptions = {},
): Promise<void> {
  const coordinationKey = options.coordinationKey ?? computerUse;
  if ((readyUntil.get(coordinationKey) ?? 0) > Date.now()) return;
  const existing = readinessPromises.get(coordinationKey);
  if (existing) return await existing;

  const pending = ensureComputerUseReadyUncoalesced(computerUse, coordinationKey, options);
  readinessPromises.set(coordinationKey, pending);
  try {
    await pending;
  } finally {
    if (readinessPromises.get(coordinationKey) === pending) {
      readinessPromises.delete(coordinationKey);
    }
  }
}

/**
 * Reattaches the VNC transport after a client proves that a nominally running
 * stream cannot reach its downstream server. A healthy x11vnc stays attached
 * to the desktop while noVNC is replaced, preserving the active VNC session.
 */
async function recoverComputerUseStreamUncoalesced(
  computerUse: ComputerUseLifecycle,
  options: RecoverComputerUseStreamOptions = {},
): Promise<void> {
  invalidateComputerUseReadiness(computerUse);
  if (!computerUse.restartProcess) {
    throw new Error("The sandbox cannot restart the failed desktop stream processes.");
  }

  const errors: unknown[] = [];
  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const deadline = Date.now() + timeoutMs;

  const x11vncWasReady = options.probePort
    ? await probePortOnce(options.probePort, VNC_SERVER_PORT, deadline)
    : false;
  if (!x11vncWasReady) {
    await restartFailedProcesses(computerUse, ["x11vnc"], errors, deadline);
  }

  const x11vncReady = x11vncWasReady || !options.probePort || await waitForPort(
    options.probePort,
    VNC_SERVER_PORT,
    deadline,
    pollIntervalMs,
  );
  if (!x11vncReady) {
    errors.push(new Error(`x11vnc did not accept connections on port ${VNC_SERVER_PORT}.`));
  } else {
    // noVNC must start after x11vnc is accepting downstream connections. A
    // running process flag alone can arrive before either socket is bound.
    await restartFailedProcesses(computerUse, ["novnc"], errors, deadline);
    if (
      options.probePort
      && !await waitForPort(options.probePort, NOVNC_SERVER_PORT, deadline, pollIntervalMs)
    ) {
      errors.push(new Error(`noVNC did not accept connections on port ${NOVNC_SERVER_PORT}.`));
    }
  }

  const snapshot = await waitForReady(
    computerUse,
    deadline,
    pollIntervalMs,
    transportProcessesReady,
  );
  if (errors.length > 0 || !transportProcessesReady(snapshot)) {
    throw await readinessError(computerUse, snapshot, errors);
  }
}

export async function recoverComputerUseStream(
  computerUse: ComputerUseLifecycle,
  options: RecoverComputerUseStreamOptions = {},
): Promise<void> {
  const existing = streamRecoveryPromises.get(computerUse);
  if (existing) return await existing;

  const pending = recoverComputerUseStreamUncoalesced(computerUse, options);
  streamRecoveryPromises.set(computerUse, pending);
  try {
    await pending;
  } finally {
    if (streamRecoveryPromises.get(computerUse) === pending) {
      streamRecoveryPromises.delete(computerUse);
    }
  }
}

export function invalidateComputerUseReadiness(coordinationKey: object): void {
  readyUntil.delete(coordinationKey);
}
