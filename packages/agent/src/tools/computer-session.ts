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
const sessions = new WeakMap<DaytonaSandbox, Map<string, CuaToolSession>>();

function clientKey(options: CuaComputerOptions): string {
  return JSON.stringify([
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
  const key = clientKey(options);
  const sandboxSessions = sessions.get(sandbox) ?? new Map<string, CuaToolSession>();
  sessions.set(sandbox, sandboxSessions);
  const existing = sandboxSessions.get(key);
  if (existing) return existing;

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
