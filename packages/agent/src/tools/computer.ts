import { hasNumberType, hasStringType, hasUndefinedType } from "@autopr/config/runtime-type";
import { isJsonObject, jsonValueSchema, type JsonObject, type JsonValue } from "@autopr/config/runtime-value";

import { tool } from "ai";
import type { ComputerUse } from "@daytona/sdk";
import { z } from "zod";
import { ensureComputerUseReady } from "@autopr/config/computer-use-lifecycle";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import {
  type CuaAgentCursorStatus,
  type CuaCommandResponse,
  type CuaComputerClientContract,
  type CuaComputerOptions,
} from "./cua-client";
import {
  captureCuaObservation,
  observationPointToScreen,
  screenshotForModel,
  type CuaObservation,
  type ScreenshotRequest,
} from "./computer-observation";
import {
  getCuaToolSession,
  nextObservationSequence,
  recordTrajectory,
  type CuaToolSession,
  type CuaTrajectoryEvent,
} from "./computer-session";
import { raceWithTimeout } from "./timeout";

export const COMPUTER_METADATA_PREFIX = "AUTOPR_COMPUTER_METADATA ";

const MAX_COMPUTER_DIAGNOSTIC_LENGTH = 400;
const MAX_COMPUTER_METADATA_CHARS = 8_000;
const MAX_RECORDINGS_RETURNED = 25;
const MAX_TRAJECTORY_RETURNED = 10;
const COMPUTER_ACTION_TIMEOUT_MS = 120_000;
const COMPUTER_START_TIMEOUT_MS = 8 * 60_000;
const computerOperationTails = new WeakMap<object, Promise<void>>();

type ComputerUseLifecycle = ComputerUse;
type TrackComputerOperation = (operation: Promise<unknown>) => void;

async function serializeComputerOperations<T>(
  computerUse: ComputerUseLifecycle,
  operation: (track: TrackComputerOperation) => Promise<T>,
): Promise<T> {
  const previous = computerOperationTails.get(computerUse) ?? Promise.resolve();
  let lastSdkOperation: Promise<unknown> = Promise.resolve();
  const execution = previous
    .catch(() => undefined)
    .then(() => operation((pending) => {
      lastSdkOperation = pending;
    }));
  const tail = execution
    .then(() => lastSdkOperation, () => lastSdkOperation)
    .then(() => undefined, () => undefined);
  computerOperationTails.set(computerUse, tail);
  void tail.finally(() => {
    if (computerOperationTails.get(computerUse) === tail) computerOperationTails.delete(computerUse);
  });
  return execution;
}

function runBoundedComputerOperation<T>(
  track: TrackComputerOperation,
  operation: () => Promise<T>,
  timeoutError: () => Error,
  timeoutMs = COMPUTER_ACTION_TIMEOUT_MS,
): Promise<T> {
  const pending = Promise.resolve().then(operation);
  track(pending);
  return raceWithTimeout(() => pending, timeoutMs, timeoutError);
}

const mouseButtonSchema = z.enum(["left", "right", "middle"]);
const modifierSchema = z.enum(["ctrl", "alt", "meta", "cmd", "shift"]);
const screenCoordinateSchema = z.number().int().min(0).max(100_000).describe(
  "Pixel coordinate from the observation named by observationId.",
);
const screenPointSchema = z.object({ x: screenCoordinateSchema, y: screenCoordinateSchema });
const observationIdSchema = z.string().min(8).max(128).describe(
  "Exact observation ID from the latest returned screenshot.",
);
const scrollDirectionSchema = z.enum(["up", "down", "left", "right"]);
const windowIdSchema = z.union([z.string().min(1).max(256), z.number().int()]);
const browserUrlSchema = z.string().min(1).max(4_096).refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "URL must be an absolute http:// or https:// URL.");
const screenshotRegionSchema = z.object({
  x: screenCoordinateSchema,
  y: screenCoordinateSchema,
  width: z.number().int().min(1).max(100_000),
  height: z.number().int().min(1).max(100_000),
});

const computerActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("status") }),
  z.object({ type: z.literal("display") }),
  z.object({ type: z.literal("windows"), app: z.string().trim().min(1).max(256).optional() }),
  z.object({ type: z.literal("focus_window"), windowId: windowIdSchema }),
  z.object({ type: z.literal("maximize_window"), windowId: windowIdSchema }),
  z.object({ type: z.literal("open_url"), url: browserUrlSchema }),
  z.object({
    type: z.literal("screenshot"),
    format: z.enum(["jpeg", "png"]).optional(),
    quality: z.number().int().min(1).max(95).optional(),
    region: screenshotRegionSchema.optional().describe("Crop in full CUA screenshot coordinates."),
    windowId: windowIdSchema.optional().describe("Crop to this CUA window and keep that zoom for later actions."),
  }),
  z.object({ type: z.literal("wait"), ms: z.number().int().min(100).max(10_000).optional() }),
  z.object({
    type: z.literal("move"),
    observationId: observationIdSchema,
    x: screenCoordinateSchema,
    y: screenCoordinateSchema,
  }),
  z.object({
    type: z.literal("click"),
    observationId: observationIdSchema,
    x: screenCoordinateSchema,
    y: screenCoordinateSchema,
    button: mouseButtonSchema.optional(),
  }),
  z.object({
    type: z.literal("double_click"),
    observationId: observationIdSchema,
    x: screenCoordinateSchema,
    y: screenCoordinateSchema,
    button: mouseButtonSchema.optional(),
  }),
  z.object({
    type: z.literal("drag"),
    observationId: observationIdSchema,
    path: z.array(screenPointSchema).min(2).max(200),
    button: mouseButtonSchema.optional(),
    durationMs: z.number().int().min(0).max(10_000).optional(),
  }),
  z.object({
    type: z.literal("scroll"),
    observationId: observationIdSchema,
    x: screenCoordinateSchema,
    y: screenCoordinateSchema,
    direction: scrollDirectionSchema,
    amount: z.number().int().min(1).max(50).optional(),
  }),
  z.object({ type: z.literal("type"), text: z.string().min(1).max(64 * 1024) }),
  z.object({
    type: z.literal("keypress"),
    key: z.string().min(1).max(128),
    modifiers: z.array(modifierSchema).max(8).optional(),
  }),
  z.object({ type: z.literal("hotkey"), keys: z.string().min(1).max(256) }),
  z.object({ type: z.literal("clipboard_read") }),
  z.object({ type: z.literal("clipboard_write"), text: z.string().max(256 * 1024) }),
  z.object({ type: z.literal("start_recording"), title: z.string().trim().min(3).max(120) }),
  z.object({
    type: z.literal("stop_recording"),
    recordingId: z.string().min(1).max(256),
    title: z.string().trim().min(3).max(120),
  }),
  z.object({ type: z.literal("get_recording"), recordingId: z.string().min(1).max(256) }),
  z.object({ type: z.literal("list_recordings") }),
]);

type ComputerAction = z.infer<typeof computerActionSchema>;

export interface CuaComputerToolOptions extends CuaComputerOptions {
  /** Allows starting new Daytona recordings. Keep disabled outside demo-enabled turns. */
  recordingEnabled?: boolean;
}

export interface CuaComputerDependencies {
  getSandboxContext: typeof getSandboxContext;
  getSession: typeof getCuaToolSession;
}

const defaultDependencies: CuaComputerDependencies = {
  getSandboxContext,
  getSession: getCuaToolSession,
};

type DaytonaRecording = {
  id?: JsonValue;
  title?: JsonValue;
  label?: JsonValue;
  name?: JsonValue;
  fileName?: JsonValue;
  filePath?: JsonValue;
  status?: JsonValue;
  startTime?: JsonValue;
  endTime?: JsonValue;
  durationSeconds?: JsonValue;
  sizeBytes?: JsonValue;
};

type ScreenshotForModel = ReturnType<typeof screenshotForModel>;
type ScreenshotMetadata = Omit<ScreenshotForModel, "data"> & {
  data?: string;
  payloadLength?: number;
  payloadStripped?: boolean;
};

type ComputerOutputDetails = {
  action: string;
  display?: { x?: number; y?: number; width?: number; height?: number };
  status?: JsonValue;
  cursor?: CuaAgentCursorStatus;
  windows?: JsonValue;
  clipboard?: string;
  command?: JsonObject;
  screenshot?: ScreenshotForModel | ScreenshotMetadata;
  recording?: ReturnType<typeof compactRecording>;
  recordings?: Array<ReturnType<typeof compactRecording>>;
  recordingsTruncated?: boolean;
  trajectory?: CuaTrajectoryEvent;
  recentTrajectory?: CuaTrajectoryEvent[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord<Value>(value: Value): value is Value & JsonObject {
  return isJsonObject(value);
}

function numberField(value: JsonObject, key: string): number | undefined {
  const field = value[key];
  return hasNumberType(field) ? field : undefined;
}

function statusValue<Value>(value: Value): string | undefined {
  if (!isRecord(value)) return undefined;
  return hasStringType(value.status) ? value.status.toLowerCase() : undefined;
}

function compactDiagnostic<ValueValue>(value: ValueValue): string | undefined {
  if (hasUndefinedType(value) || value === null) return undefined;
  let raw: string;
  try {
    raw = hasStringType(value) ? value : JSON.stringify(value) ?? String(value);
  } catch {
    raw = String(value);
  }
  const normalized = raw.trim().replace(/\s+/g, " ");
  return normalized.length > MAX_COMPUTER_DIAGNOSTIC_LENGTH
    ? `${normalized.slice(0, MAX_COMPUTER_DIAGNOSTIC_LENGTH)}...`
    : normalized;
}

function compactMetadataValue<ValueValue>(value: ValueValue): JsonValue {
  if (hasUndefinedType(value)) return undefined;
  if (value === null) return null;
  try {
    if (hasStringType(value)) return value;
    const serialized = JSON.stringify(value);
    if (!serialized) return String(value);
    if (serialized.length <= MAX_COMPUTER_METADATA_CHARS) {
      return jsonValueSchema.parse(JSON.parse(serialized));
    }
    return { truncated: true, preview: `${serialized.slice(0, MAX_COMPUTER_METADATA_CHARS)}...` };
  } catch {
    return { truncated: true, preview: String(value).slice(0, MAX_COMPUTER_METADATA_CHARS) };
  }
}

function cleanRecordingTitle<Value>(value: Value): string | undefined {
  if (!hasStringType(value)) return undefined;
  const title = value.replace(/\s+/g, " ").trim();
  return title.length > 0 ? title : undefined;
}

function recordingTitleFromFileName(fileName: string | undefined): string | undefined {
  if (!fileName) return undefined;
  const baseName = fileName.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "";
  const words = baseName.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!words || /^[a-f0-9]{8,}$/i.test(words.replace(/\s+/g, ""))) return undefined;
  return words.replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

function recordingTitle(recording: DaytonaRecording, fileName: string | undefined, titleHint?: string) {
  return cleanRecordingTitle(recording.title)
    ?? cleanRecordingTitle(recording.label)
    ?? cleanRecordingTitle(recording.name)
    ?? cleanRecordingTitle(titleHint)
    ?? recordingTitleFromFileName(fileName)
    ?? "Demo Walkthrough";
}

function compactRecording<Value>(value: Value, titleHint?: string) {
  const recording: DaytonaRecording = isRecord(value) ? value : {};
  const id = hasStringType(recording.id) ? recording.id : "";
  const fileName = hasStringType(recording.fileName) ? recording.fileName : undefined;
  return {
    type: "daytona_recording",
    id,
    title: recordingTitle(recording, fileName, titleHint),
    fileName,
    filePath: hasStringType(recording.filePath) ? recording.filePath : undefined,
    status: hasStringType(recording.status) ? recording.status : undefined,
    startTime: hasStringType(recording.startTime) ? recording.startTime : undefined,
    endTime: hasStringType(recording.endTime) ? recording.endTime : undefined,
    durationSeconds: hasNumberType(recording.durationSeconds) ? recording.durationSeconds : undefined,
    sizeBytes: hasNumberType(recording.sizeBytes) ? recording.sizeBytes : undefined,
    contentType: "video/mp4",
  };
}

function recordingSummary(recording: ReturnType<typeof compactRecording>) {
  const parts = [`Recording "${recording.title}"`];
  if (recording.status) parts.push(recording.status);
  if (hasNumberType(recording.durationSeconds)) parts.push(`${recording.durationSeconds.toFixed(1)}s`);
  return parts.join(" - ");
}

function coordinatePoints(action: ComputerAction): Array<{ x: number; y: number }> {
  switch (action.type) {
    case "move":
    case "click":
    case "double_click":
    case "scroll":
      return [{ x: action.x, y: action.y }];
    case "drag":
      return action.path;
    default:
      return [];
  }
}

function observationIdForAction(action: ComputerAction): string | undefined {
  return "observationId" in action ? action.observationId : undefined;
}

function requireCurrentObservation(action: ComputerAction, session: CuaToolSession): CuaObservation | undefined {
  if (coordinatePoints(action).length === 0) return undefined;
  const current = session.lastObservation;
  if (!current) throw new Error("Capture a CUA screenshot before using image coordinates.");
  const requestedId = observationIdForAction(action);
  if (requestedId !== current.id) {
    throw new Error(
      `Stale CUA observation ${requestedId ?? "missing"}. `
      + `The latest observation is ${current.id}; inspect it and retry with that exact observationId.`,
    );
  }
  for (const point of coordinatePoints(action)) observationPointToScreen(current, point);
  return current;
}

function mapPoint(observation: CuaObservation, point: { x: number; y: number }) {
  return observationPointToScreen(observation, point);
}

function requiresDaytonaDesktop(action: ComputerAction) {
  return !["status", "stop_recording", "get_recording", "list_recordings"].includes(action.type);
}

function requiresCua(action: ComputerAction) {
  return !["status", "stop_recording", "get_recording", "list_recordings"].includes(action.type);
}

function shouldCaptureAfter(action: ComputerAction) {
  return [
    "start",
    "focus_window",
    "maximize_window",
    "open_url",
    "screenshot",
    "wait",
    "move",
    "click",
    "double_click",
    "drag",
    "scroll",
    "type",
    "keypress",
    "hotkey",
  ].includes(action.type);
}

function summarizeAction(action: ComputerAction) {
  switch (action.type) {
    case "start":
    case "status":
    case "display":
    case "clipboard_read":
    case "list_recordings":
      return action.type;
    case "windows":
      return action.app ? `windows(${action.app})` : "windows(active)";
    case "focus_window":
    case "maximize_window":
      return `${action.type}(${action.windowId})`;
    case "open_url":
      return `open_url(${action.url})`;
    case "screenshot":
      return action.windowId !== undefined
        ? `screenshot(window=${action.windowId})`
        : action.region
          ? `screenshot(region=${action.region.x},${action.region.y},${action.region.width},${action.region.height})`
          : "screenshot(full)";
    case "wait":
      return `wait(${action.ms ?? 1000}ms)`;
    case "move":
      return `move(${action.x},${action.y})`;
    case "click":
      return `click(${action.x},${action.y},${action.button ?? "left"})`;
    case "double_click":
      return `double_click(${action.x},${action.y},${action.button ?? "left"})`;
    case "drag":
      return `drag(${action.path.length} points,${action.button ?? "left"})`;
    case "scroll":
      return `scroll(${action.x},${action.y},${action.direction},${action.amount ?? 3})`;
    case "type":
    case "clipboard_write":
      return `${action.type}(${action.text.length} chars)`;
    case "keypress":
      return `keypress(${[...(action.modifiers ?? []), action.key].join("+")})`;
    case "hotkey":
      return `hotkey(${action.keys})`;
    case "start_recording":
      return `start_recording(${action.title})`;
    case "stop_recording":
      return `stop_recording(${action.recordingId}, ${action.title})`;
    case "get_recording":
      return `get_recording(${action.recordingId})`;
  }
}

function compactMetadataObject(value: JsonObject): JsonObject {
  const compacted = compactMetadataValue(value);
  return isJsonObject(compacted) ? compacted : { value: compacted };
}

function commandDetails(result: JsonObject) {
  return { command: compactMetadataObject(result) };
}

async function windowDetails(cua: CuaComputerClientContract, windowId: string | number) {
  const [name, size, position] = await Promise.all([
    cua.command("get_window_name", { window_id: windowId }),
    cua.command("get_window_size", { window_id: windowId }),
    cua.command("get_window_position", { window_id: windowId }),
  ]);
  return {
    id: windowId,
    name: name.name,
    width: size.width,
    height: size.height,
    x: position.x,
    y: position.y,
  };
}

type ActionResult = Partial<ComputerOutputDetails>;

async function runOneAction(
  action: ComputerAction,
  context: Awaited<ReturnType<typeof getSandboxContext>>,
  cua: CuaComputerClientContract,
  observation: CuaObservation | undefined,
): Promise<ActionResult> {
  const { computerUse } = context.sandbox;
  switch (action.type) {
    case "start":
      await ensureComputerUseReady(computerUse);
      await cua.ensureReady();
      return {
        status: compactMetadataValue({
          status: "active",
          provider: "cua",
          server: await cua.inspect(),
          daytonaDesktop: await computerUse.getStatus(),
        }),
      };
    case "status": {
      const server = await cua.inspect().catch((error) => ({
        status: "unavailable",
        error: compactDiagnostic(error instanceof Error ? error.message : error),
      }));
      return {
        status: compactMetadataValue({
          status: isRecord(server) && server.status === "ok" ? "active" : "inactive",
          provider: "cua",
          server,
          daytonaDesktop: await computerUse.getStatus(),
        }),
      };
    }
    case "display": {
      const result = await cua.command("get_screen_size");
      const size = isRecord(result.size) ? result.size : {};
      return { display: { width: numberField(size, "width"), height: numberField(size, "height") } };
    }
    case "windows": {
      let ids: Array<string | number> = [];
      if (action.app) {
        const result = await cua.command("get_application_windows", { app: action.app });
        ids = Array.isArray(result.windows)
          ? result.windows.filter((id): id is string | number => hasStringType(id) || hasNumberType(id))
          : [];
      } else {
        const current = await cua.command("get_current_window_id");
        if (hasStringType(current.window_id) || hasNumberType(current.window_id)) {
          ids = [current.window_id];
        }
      }
      const windows = await Promise.all(ids.map(async (id) => {
        try {
          return await windowDetails(cua, id);
        } catch {
          return { id };
        }
      }));
      return { windows };
    }
    case "focus_window":
      return commandDetails(await cua.command("activate_window", { window_id: action.windowId }));
    case "maximize_window":
      return commandDetails(await cua.command("maximize_window", { window_id: action.windowId }));
    case "open_url":
      return commandDetails(await cua.command("open", { target: action.url }));
    case "screenshot":
      if (action.region && action.windowId !== undefined) {
        throw new Error("Choose either screenshot.region or screenshot.windowId, not both.");
      }
      return {};
    case "wait":
      await sleep(action.ms ?? 1000);
      return {};
    case "move": {
      const point = mapPoint(observation!, action);
      return commandDetails(await cua.command("move_cursor", point));
    }
    case "click": {
      const point = mapPoint(observation!, action);
      if (action.button === "middle") {
        return commandDetails(await cua.command("middle_click", point));
      }
      return commandDetails(await cua.command(action.button === "right" ? "right_click" : "left_click", point));
    }
    case "double_click": {
      const point = mapPoint(observation!, action);
      if (action.button === "middle") {
        let result: CuaCommandResponse = { success: true };
        for (let index = 0; index < 2; index += 1) {
          result = await cua.command("middle_click", point);
        }
        return commandDetails(result);
      }
      if (action.button === "right") {
        await cua.command("right_click", point);
        return commandDetails(await cua.command("right_click", point));
      }
      return commandDetails(await cua.command("double_click", point));
    }
    case "drag": {
      const path = action.path.map((point) => {
        const mapped = mapPoint(observation!, point);
        return [mapped.x, mapped.y];
      });
      return commandDetails(await cua.command("drag", {
        path,
        button: action.button ?? "left",
        duration: (action.durationMs ?? 500) / 1000,
      }));
    }
    case "scroll": {
      const point = mapPoint(observation!, action);
      await cua.command("move_cursor", point);
      return commandDetails(await cua.command("scroll_direction", {
        direction: action.direction,
        clicks: action.amount ?? 3,
      }));
    }
    case "type":
      return commandDetails(await cua.command("type_text", { text: action.text }));
    case "keypress": {
      const modifiers = action.modifiers?.map((modifier) => modifier === "cmd" ? "meta" : modifier);
      return commandDetails(modifiers?.length
        ? await cua.command("hotkey", { keys: [...modifiers, action.key] })
        : await cua.command("press_key", { key: action.key }));
    }
    case "hotkey": {
      const keys = action.keys.split("+")
        .map((key) => key.trim().toLowerCase())
        .filter(Boolean)
        .map((key) => key === "cmd" ? "meta" : key);
      if (keys.length === 0) throw new Error("CUA hotkey requires at least one key.");
      return commandDetails(await cua.command("hotkey", { keys }));
    }
    case "clipboard_read": {
      const result = await cua.command("copy_to_clipboard");
      return {
        ...commandDetails(result),
        clipboard: hasStringType(result.content)
          ? result.content
          : hasStringType(result.text)
            ? result.text
            : "",
      };
    }
    case "clipboard_write":
      return commandDetails(await cua.command("set_clipboard", { text: action.text }));
    case "start_recording": {
      const recording = compactRecording(
        /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ await computerUse.recording.start(action.title) as DaytonaRecording,
        action.title,
      );
      return { recording, recordings: [recording] };
    }
    case "stop_recording": {
      const recording = compactRecording(
        /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ await computerUse.recording.stop(action.recordingId) as DaytonaRecording,
        action.title,
      );
      return { recording, recordings: [recording] };
    }
    case "get_recording": {
      const recording = compactRecording(
        /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ await computerUse.recording.get(action.recordingId) as DaytonaRecording,
      );
      return { recording, recordings: [recording] };
    }
    case "list_recordings": {
      const result = await computerUse.recording.list();
      const all = isRecord(result) && Array.isArray(result.recordings) ? result.recordings : [];
      return {
        recordings: all.slice(0, MAX_RECORDINGS_RETURNED).map((recording) => compactRecording(recording)),
        recordingsTruncated: all.length > MAX_RECORDINGS_RETURNED,
      };
    }
  }
}

function screenshotRequest(action: ComputerAction, session: CuaToolSession): ScreenshotRequest {
  if (action.type !== "screenshot") return session.observationRequest ?? {};
  return {
    format: action.format,
    quality: action.quality,
    region: action.region,
    windowId: action.windowId,
  };
}

function captureTiming(action: ComputerAction) {
  if (action.type === "open_url") return { initialDelayMs: 250 };
  if (["screenshot", "wait", "start"].includes(action.type)) return { initialDelayMs: 0 };
  return { initialDelayMs: 100 };
}

function mergeDetails(details: ComputerOutputDetails, partial: ActionResult): void {
  if (partial.status !== undefined) details.status = partial.status;
  if (partial.display !== undefined) details.display = partial.display;
  if (partial.windows !== undefined) details.windows = partial.windows;
  if (partial.clipboard !== undefined) details.clipboard = partial.clipboard;
  if (partial.command !== undefined) details.command = partial.command;
  if (partial.recording !== undefined) details.recording = partial.recording;
  if (partial.recordings !== undefined) details.recordings = partial.recordings;
  if (partial.recordingsTruncated !== undefined) details.recordingsTruncated = partial.recordingsTruncated;
}

function compactDetailsForMetadata(details: ComputerOutputDetails): ComputerOutputDetails {
  if (!details.screenshot?.data) return details;
  const { data: _data, ...screenshot } = details.screenshot;
  return {
    ...details,
    screenshot: {
      ...screenshot,
      payloadStripped: true,
      payloadLength: details.screenshot.data.length,
    },
  };
}

function computerContentOutput(content: string, details: ComputerOutputDetails) {
  const value: Array<
    | { type: "text"; text: string }
    | { type: "image-data"; data: string; mediaType: string }
  > = [
    { type: "text", text: content },
    { type: "text", text: `${COMPUTER_METADATA_PREFIX}${JSON.stringify(compactDetailsForMetadata(details))}` },
  ];
  if (details.screenshot?.data) {
    const image = {
      type: "image-data",
      data: details.screenshot.data,
      mediaType: details.screenshot.mimeType,
    } satisfies { type: "image-data"; data: string; mediaType: string };
    Object.defineProperty(image, "data", {
      configurable: false,
      enumerable: false,
      writable: false,
    });
    value.push(image);
  }
  return { type: "content" as const, value };
}

async function executeCuaComputer(
  action: ComputerAction,
  sandboxOptions: SandboxSessionOptions,
  computerOptions: CuaComputerToolOptions,
  dependencies: CuaComputerDependencies,
) {
  if (computerOptions.recordingEnabled !== true && action.type === "start_recording") {
    throw new Error("Demo recording is disabled for this thread. Enable demo mode before starting a screen recording.");
  }
  const context = await dependencies.getSandboxContext(sandboxOptions);
  const session = dependencies.getSession(context.sandbox, sandboxOptions, computerOptions);
  return serializeComputerOperations(context.sandbox.computerUse, (track) => executeCuaComputerAction(
    action,
    context,
    session,
    track,
  ));
}

async function executeCuaComputerAction(
  action: ComputerAction,
  context: Awaited<ReturnType<typeof getSandboxContext>>,
  session: CuaToolSession,
  track: TrackComputerOperation,
) {
  const summary = summarizeAction(action);
  const details: ComputerOutputDetails = { action: summary };
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const inputObservationId = observationIdForAction(action);
  let command: JsonObject | undefined;
  let outputObservation: CuaObservation | undefined;

  try {
    if (requiresDaytonaDesktop(action)) {
      await runBoundedComputerOperation(
        track,
        async () => {
          await ensureComputerUseReady(context.sandbox.computerUse);
          if (requiresCua(action)) details.cursor = (await session.client.ensureReady()).cursor;
        },
        () => new Error("Timed out waiting for the Daytona desktop and CUA gateway to become ready."),
        COMPUTER_START_TIMEOUT_MS,
      );
    }

    const observation = requireCurrentObservation(action, session);
    const partial = await runBoundedComputerOperation(
      track,
      () => runOneAction(action, context, session.client, observation),
      () => new Error(`Timed out running CUA computer action ${action.type}.`),
    );
    mergeDetails(details, partial);
    command = partial.command;

    if (shouldCaptureAfter(action)) {
      const request = screenshotRequest(action, session);
      session.observationRequest = request;
      const captured = await runBoundedComputerOperation(
        track,
        () => captureCuaObservation(session.client, request, {
          sequence: nextObservationSequence(session),
          ...captureTiming(action),
        }),
        () => new Error("Timed out capturing the CUA desktop observation."),
      );
      session.lastObservation = captured;
      outputObservation = captured;
      details.screenshot = screenshotForModel(captured);
      details.display = {
        x: captured.origin.x,
        y: captured.origin.y,
        width: captured.width,
        height: captured.height,
      };
    }

    const trajectory = recordTrajectory(session, {
      action: summary,
      startedAt: startedAtIso,
      durationMs: Date.now() - startedAt,
      status: "completed",
      inputObservationId,
      outputObservationId: outputObservation?.id,
      screenshotHash: outputObservation?.hash,
      effect: hasStringType(command?.effect) ? command.effect : undefined,
      transportRetries: hasNumberType(command?.transport_retries) ? command.transport_retries : undefined,
    });
    details.trajectory = trajectory;
  } catch (error) {
    recordTrajectory(session, {
      action: summary,
      startedAt: startedAtIso,
      durationMs: Date.now() - startedAt,
      status: "failed",
      inputObservationId,
      error: compactDiagnostic(error instanceof Error ? error.message : String(error)),
    });
    throw error;
  }

  details.recentTrajectory = session.trajectory.slice(-MAX_TRAJECTORY_RETURNED);
  const lines = [
    `Action: ${summary}`,
    details.screenshot
      ? `Observation: ${details.screenshot.id}, ${details.screenshot.width}x${details.screenshot.height}, `
        + `captured in ${details.screenshot.captureDurationMs}ms`
      : undefined,
    details.screenshot?.captureKind === "desktop_state" ? "Capture: atomic CUA desktop state" : undefined,
    details.screenshot?.origin.x || details.screenshot?.origin.y
      ? `Observation origin: (${details.screenshot.origin.x}, ${details.screenshot.origin.y})`
      : undefined,
    details.recording ? recordingSummary(details.recording) : undefined,
    details.recordings && !details.recording
      ? `Found ${details.recordings.length} recording${details.recordings.length === 1 ? "" : "s"}`
      : undefined,
    hasStringType(details.command?.effect) ? `CUA action effect: ${details.command.effect}` : undefined,
    hasNumberType(details.command?.transport_retries)
      ? `CUA transport retries: ${details.command.transport_retries}`
      : undefined,
    details.cursor?.enabled ? "Agent cursor: official CUA overlay" : undefined,
    statusValue(details.status) ? `Status: ${statusValue(details.status)}` : undefined,
  ].filter(Boolean);
  return computerContentOutput(lines.join("\n"), details);
}

export function createCuaComputerTool(
  sandboxOptions: SandboxSessionOptions,
  computerOptions: CuaComputerToolOptions = {},
  dependencies: CuaComputerDependencies = defaultDependencies,
) {
  const recordingDescription = computerOptions.recordingEnabled === true
    ? "Daytona recording actions are enabled."
    : "Starting a screen recording is disabled for this thread.";
  return tool<ComputerAction, Awaited<ReturnType<typeof executeCuaComputer>>>({
    title: "computer",
    description: `Operate the Daytona Linux desktop through CUA only. ${recordingDescription} `
      + "Use one action per call and use open_url directly for browser navigation. Capture a screenshot before "
      + "coordinate actions, then pass its exact observationId with every "
      + "coordinate action. Screenshot crops and window zooms persist, and all coordinates stay relative to the "
      + "latest returned image. Every visible action returns one fresh CUA observation.",
    inputSchema: computerActionSchema,
    toModelOutput: ({ output }) => output,
    execute: (action) => executeCuaComputer(action, sandboxOptions, computerOptions, dependencies),
  });
}
