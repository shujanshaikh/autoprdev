import type { DaytonaSandbox, SandboxSessionOptions } from "../sandbox";
import { CuaComputerClient, type CuaComputerOptions } from "./cua-client";
import type { CuaObservation, ScreenshotRequest } from "./computer-observation";

export type CuaTrajectoryEvent = {
  id: string;
  action: string;
  startedAt: string;
  durationMs: number;
  status: "completed" | "failed";
  inputObservationId?: string;
  outputObservationId?: string;
  screenshotHash?: string;
  effect?: string;
  transportRetries?: number;
  error?: string;
};

export type CuaToolSession = {
  client: CuaComputerClient;
  lastObservation?: CuaObservation;
  observationRequest?: ScreenshotRequest;
  observationSequence: number;
  trajectorySequence: number;
  trajectory: CuaTrajectoryEvent[];
};

const MAX_TRAJECTORY_EVENTS = 100;
const sessions = new WeakMap<object, Map<string, CuaToolSession>>();

function clientKey(sandboxId: string, options: CuaComputerOptions): string {
  return JSON.stringify([
    sandboxId,
    options.display ?? null,
    options.serverPort ?? null,
    options.requestTimeoutMs ?? null,
  ]);
}

export function getCuaToolSession(
  sandbox: DaytonaSandbox,
  sandboxOptions: SandboxSessionOptions,
  options: CuaComputerOptions,
): CuaToolSession {
  // Daytona refreshes its SDK wrapper on a short TTL. The tool options object
  // lives for the whole agent turn, so keying by it preserves the observation,
  // trajectory, and operation queue when the wrapper is refreshed.
  const key = clientKey(sandbox.id, options);
  const sandboxSessions = sessions.get(sandboxOptions) ?? new Map<string, CuaToolSession>();
  sessions.set(sandboxOptions, sandboxSessions);
  const existing = sandboxSessions.get(key);
  if (existing) {
    existing.client.updateSandbox(sandbox);
    return existing;
  }

  const session: CuaToolSession = {
    client: new CuaComputerClient(sandbox, sandboxOptions, options),
    observationSequence: 0,
    trajectorySequence: 0,
    trajectory: [],
  };
  sandboxSessions.set(key, session);
  return session;
}

export function nextObservationSequence(session: CuaToolSession): number {
  session.observationSequence += 1;
  return session.observationSequence;
}

export function recordTrajectory(
  session: CuaToolSession,
  event: Omit<CuaTrajectoryEvent, "id">,
): CuaTrajectoryEvent {
  session.trajectorySequence += 1;
  const stored = { ...event, id: `cua-${session.trajectorySequence}` };
  session.trajectory.push(stored);
  if (session.trajectory.length > MAX_TRAJECTORY_EVENTS) {
    session.trajectory.splice(0, session.trajectory.length - MAX_TRAJECTORY_EVENTS);
  }
  return stored;
}
