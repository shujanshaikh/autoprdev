import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import {
  CuaComputerClient,
  type CuaAgentCursorStatus,
  type CuaCommandResponse,
  type CuaComputerOptions,
} from "./cua-client";
import { raceWithTimeout } from "./timeout";

export const COMPUTER_METADATA_PREFIX = "AUTOPR_COMPUTER_METADATA ";

const COMPUTER_READY_TIMEOUT_MS = 30_000;
const COMPUTER_READY_POLL_MS = 1_000;
const COMPUTER_RECOVERY_DELAY_MS = 1_000;
const MAX_COMPUTER_DIAGNOSTIC_LENGTH = 400;
// Lossless screenshots keep small controls and text crisp enough for reliable
// visual grounding. Callers can still request JPEG when payload size matters.
const DEFAULT_SCREENSHOT_FORMAT = "png";
const DEFAULT_SCREENSHOT_QUALITY = 85;
const MAX_COMPUTER_METADATA_CHARS = 8_000;
const MAX_RECORDINGS_RETURNED = 25;
const COMPUTER_ACTION_TIMEOUT_MS = 120_000;
const COMPUTER_START_TIMEOUT_MS = 8 * 60_000;
const COMPUTER_USE_PROCESS_NAMES = ["xvfb", "xfce4", "x11vnc", "novnc"] as const;
const computerOperationTails = new WeakMap<object, Promise<void>>();

type TrackComputerOperation = (operation: Promise<unknown>) => void;

async function serializeComputerOperations<T>(
  computerUse: object,
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
    if (computerOperationTails.get(computerUse) === tail) {
      computerOperationTails.delete(computerUse);
    }
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
  return raceWithTimeout(
    () => pending,
    timeoutMs,
    timeoutError,
  );
}

const mouseButtonSchema = z.enum(["left", "right", "middle"]);
const modifierSchema = z.enum(["ctrl", "alt", "meta", "cmd", "shift"]);
const screenCoordinateSchema = z.number().int().min(0).max(100_000).describe(
  "Image-space pixel coordinate from the most recent screenshot, measured from its top-left corner.",
);
const screenPointSchema = z.union([
  z.tuple([screenCoordinateSchema, screenCoordinateSchema]),
  z.object({ x: screenCoordinateSchema, y: screenCoordinateSchema }),
]);
const scrollDirectionSchema = z.enum(["up", "down", "left", "right"]);
const browserUrlSchema = z.string().min(1).max(4_096).refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "URL must be an absolute http:// or https:// URL.");

const screenshotOptionsSchema = {
  format: z.enum(["jpeg", "png"]).optional().describe("CUA screenshot format."),
  quality: z.number().int().min(1).max(95).optional().describe("JPEG compression quality."),
  // The former Daytona backend accepted these fields. Keep them explicit so
  // Zod rejects unsupported requests instead of silently stripping them.
  region: z.never().optional(),
  scale: z.never().optional(),
  showCursor: z.never().optional(),
};

const legacyActionNameSchema = z.enum([
  "start",
  "status",
  "display",
  "windows",
  "open_url",
  "screenshot",
  "wait",
  "move",
  "move_mouse",
  "mouse_move",
  "click",
  "double_click",
  "drag",
  "scroll",
  "type",
  "type_text",
  "keypress",
  "press_key",
  "hotkey",
  "start_recording",
  "stop_recording",
  "get_recording",
  "list_recordings",
]);

const computerActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start").describe("Start the Daytona desktop and CUA computer-server."),
  }),
  z.object({
    type: z.literal("status").describe("Read CUA and Daytona desktop service status."),
  }),
  z.object({
    type: z.literal("display").describe("Read display information."),
  }),
  z.object({
    type: z.literal("windows").describe("Inspect the active desktop window through CUA."),
  }),
  z.object({
    type: z.literal("open_url").describe("Open a URL in the sandbox desktop browser."),
    url: browserUrlSchema.describe("Absolute HTTP(S) URL to open, usually a localhost preview chosen after inspecting the app."),
  }),
  z.object({
    type: z.literal("screenshot").describe("Capture the current desktop state."),
    ...screenshotOptionsSchema,
  }),
  z.object({
    type: z.literal("wait").describe("Wait for loading, navigation, animation, or recording to settle."),
    ms: z.number().int().min(100).max(10_000).optional(),
  }),
  z.object({
    type: z.literal("move").describe("Move the mouse cursor to absolute screen coordinates."),
    x: screenCoordinateSchema,
    y: screenCoordinateSchema,
  }),
  z.object({
    type: z.literal("click").describe("Click absolute screen coordinates."),
    x: screenCoordinateSchema,
    y: screenCoordinateSchema,
    button: mouseButtonSchema.optional(),
  }),
  z.object({
    type: z.literal("double_click").describe("Double-click absolute screen coordinates."),
    x: screenCoordinateSchema,
    y: screenCoordinateSchema,
    button: mouseButtonSchema.optional(),
  }),
  z.object({
    type: z.literal("drag").describe("Drag from one absolute screen coordinate to another."),
    startX: screenCoordinateSchema,
    startY: screenCoordinateSchema,
    endX: screenCoordinateSchema,
    endY: screenCoordinateSchema,
    button: mouseButtonSchema.optional(),
  }),
  z.object({
    type: z.literal("scroll").describe("Scroll at absolute screen coordinates."),
    x: screenCoordinateSchema,
    y: screenCoordinateSchema,
    direction: scrollDirectionSchema,
    amount: z.number().int().min(1).max(20).optional(),
  }),
  z.object({
    type: z.literal("type").describe("Type text into the focused desktop app."),
    text: z.string().min(1).max(64 * 1024),
    delayMs: z.number().int().min(0).max(1000).optional(),
  }),
  z.object({
    type: z.literal("keypress").describe("Press one key with optional modifiers."),
    key: z.string().min(1).max(128),
    modifiers: z.array(modifierSchema).max(8).optional(),
  }),
  z.object({
    type: z.literal("hotkey").describe("Press a single atomic hotkey chord such as ctrl+l or alt+tab."),
    keys: z.string().min(1).max(256),
  }),
  z.object({
    type: z.literal("start_recording").describe("Start a desktop recording."),
    title: z.string().trim().min(3).max(120).describe("Required concise title for the recording, shown above the embedded playback UI."),
  }),
  z.object({
    type: z.literal("stop_recording").describe("Stop a desktop recording by ID."),
    recordingId: z.string().min(1).max(256),
    title: z.string().trim().min(3).max(120).describe("Required concise title for the completed recording, shown above the embedded playback UI."),
  }),
  z.object({
    type: z.literal("get_recording").describe("Get metadata for one desktop recording."),
    recordingId: z.string().min(1).max(256),
  }),
  z.object({
    type: z.literal("list_recordings").describe("List desktop recordings."),
  }),
]);

const legacyActionSchema = z.object({
  action: legacyActionNameSchema.optional().describe("Legacy single-action input. Prefer actions[].type for new calls."),
  type: legacyActionNameSchema
    .optional()
    .describe("Legacy alias for action. Prefer actions[].type with canonical action names for new calls."),
  url: browserUrlSchema.optional(),
  ...screenshotOptionsSchema,
  x: screenCoordinateSchema.optional(),
  y: screenCoordinateSchema.optional(),
  button: mouseButtonSchema.optional(),
  double: z.boolean().optional(),
  startX: screenCoordinateSchema.optional(),
  startY: screenCoordinateSchema.optional(),
  endX: screenCoordinateSchema.optional(),
  endY: screenCoordinateSchema.optional(),
  path: z.array(screenPointSchema).min(2).max(200).optional(),
  direction: scrollDirectionSchema.optional(),
  amount: z.number().int().min(1).max(20).optional(),
  scrollX: z.number().int().min(-100_000).max(100_000).optional(),
  scrollY: z.number().int().min(-100_000).max(100_000).optional(),
  scroll_x: z.number().int().min(-100_000).max(100_000).optional(),
  scroll_y: z.number().int().min(-100_000).max(100_000).optional(),
  ms: z.number().int().min(100).max(10_000).optional(),
  text: z.string().max(64 * 1024).optional(),
  delay: z.number().int().min(0).max(1000).optional(),
  delayMs: z.number().int().min(0).max(1000).optional(),
  key: z.string().min(1).max(128).optional(),
  modifiers: z.array(modifierSchema).max(8).optional(),
  keys: z.union([
    z.string().min(1).max(256),
    z.array(z.string().min(1).max(128)).min(1).max(8),
  ]).optional(),
  label: z.string().max(120).optional(),
  title: z.string().max(120).optional(),
  recordingId: z.string().min(1).max(256).optional(),
});

function legacyActionToCanonical(input: z.infer<typeof legacyActionSchema>, ctx: z.RefinementCtx): ComputerAction {
  const legacy = legacyToAction(input);
  const parsed = computerActionSchema.safeParse(legacy);
  if (parsed.success) {
    return parsed.data;
  }

  ctx.addIssue({ code: "custom", message: parsed.error.message });
  return z.NEVER;
}

const computerActionInputSchema = z.union([
  computerActionSchema,
  legacyActionSchema.transform((input, ctx) => legacyActionToCanonical(input, ctx)),
]);

const computerInputSchema = legacyActionSchema.extend({
  actions: z
    .array(computerActionInputSchema)
    .min(1)
    .max(8)
    .optional()
    .describe(
      "Preferred. Ordered desktop actions to perform before returning a fresh screenshot. Use small safe batches.",
    ),
}).transform((input, ctx) => {
  if (input.actions?.length) {
    return { actions: input.actions };
  }

  if (!input.action && !input.type) {
    ctx.addIssue({ code: "custom", message: "Provide actions[] or a legacy action." });
    return z.NEVER;
  }

  return { actions: [legacyActionToCanonical(input, ctx)] };
});

type ComputerAction = z.infer<typeof computerActionSchema>;
type ComputerInput = z.infer<typeof computerInputSchema>;

export interface CuaComputerToolOptions extends CuaComputerOptions {
  /** Allows starting new Daytona recordings. Keep disabled outside demo-enabled turns. */
  recordingEnabled?: boolean;
}

type DaytonaRecording = {
  id?: unknown;
  title?: unknown;
  label?: unknown;
  name?: unknown;
  fileName?: unknown;
  filePath?: unknown;
  status?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  durationSeconds?: unknown;
  sizeBytes?: unknown;
};

type ScreenshotForModel = {
  data: string;
  mimeType: string;
  sizeBytes?: number;
  cursorPosition?: unknown;
  width?: number;
  height?: number;
  format: string;
  quality: number;
};

type ScreenshotMetadata = Omit<ScreenshotForModel, "data"> & {
  data?: string;
  payloadLength?: number;
  payloadStripped?: boolean;
};

type ComputerOutputDetails = {
  action?: string;
  actions?: string[];
  completedActions?: string[];
  remainingActions?: string[];
  pauseReason?: string;
  display?: { x?: number; y?: number; width?: number; height?: number };
  status?: unknown;
  cursor?: CuaAgentCursorStatus;
  windows?: unknown;
  command?: Record<string, unknown>;
  screenshot?: ScreenshotForModel | ScreenshotMetadata;
  recording?: ReturnType<typeof compactRecording>;
  recordings?: Array<ReturnType<typeof compactRecording>>;
  recordingsTruncated?: boolean;
};

type ComputerUseProcessName = (typeof COMPUTER_USE_PROCESS_NAMES)[number];

type ComputerUseDiagnostics = {
  processName: ComputerUseProcessName;
  status?: string;
  running?: boolean;
  errors?: string;
  logs?: string;
  diagnosticError?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusValue(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const status = value.status;
  return typeof status === "string" ? status.toLowerCase() : undefined;
}

async function waitForComputerReady(computerUse: { getStatus(): Promise<unknown> }) {
  const deadline = Date.now() + COMPUTER_READY_TIMEOUT_MS;
  let lastStatus: string | undefined;

  while (Date.now() < deadline) {
    lastStatus = statusValue(await computerUse.getStatus());
    if (lastStatus === "active") {
      return;
    }
    await sleep(COMPUTER_READY_POLL_MS);
  }

  throw new Error(`Daytona desktop was not ready${lastStatus ? `: ${lastStatus}` : ""}.`);
}

type ComputerUseLifecycle = {
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  getStatus(): Promise<unknown>;
  getProcessStatus?(processName: string): Promise<unknown>;
  restartProcess?(processName: string): Promise<unknown>;
  getProcessLogs?(processName: string): Promise<unknown>;
  getProcessErrors?(processName: string): Promise<unknown>;
};

async function readComputerStatus(computerUse: Pick<ComputerUseLifecycle, "getStatus">): Promise<string | undefined> {
  try {
    return statusValue(await computerUse.getStatus());
  } catch {
    return undefined;
  }
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
  return normalized.length > MAX_COMPUTER_DIAGNOSTIC_LENGTH
    ? `${normalized.slice(0, MAX_COMPUTER_DIAGNOSTIC_LENGTH)}...`
    : normalized;
}

function compactMetadataValue(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  try {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (!serialized || serialized.length <= MAX_COMPUTER_METADATA_CHARS) return value;
    return {
      truncated: true,
      preview: `${serialized.slice(0, MAX_COMPUTER_METADATA_CHARS)}...`,
    };
  } catch {
    return { truncated: true, preview: String(value).slice(0, MAX_COMPUTER_METADATA_CHARS) };
  }
}

function commandDetails(result: Record<string, unknown>): Pick<ComputerOutputDetails, "command"> {
  return { command: compactMetadataValue(result) as Record<string, unknown> };
}

function responseField(value: unknown, field: string): unknown {
  return isRecord(value) ? value[field] : undefined;
}

function processNamesFromComputerUseError(error: unknown): ComputerUseProcessName[] {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const matched = COMPUTER_USE_PROCESS_NAMES.filter((processName) => message.includes(processName));
  return matched.length > 0 ? matched : [...COMPUTER_USE_PROCESS_NAMES];
}

async function restartComputerUseProcesses(
  computerUse: ComputerUseLifecycle,
  processNames: ComputerUseProcessName[],
  errors: unknown[],
) {
  if (!computerUse.restartProcess) {
    errors.push(new Error("Daytona SDK does not expose computerUse.restartProcess."));
    return;
  }

  for (const processName of processNames) {
    try {
      await computerUse.restartProcess(processName);
    } catch (error) {
      errors.push(new Error(`restart ${processName}: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
}

async function collectComputerUseDiagnostics(
  computerUse: ComputerUseLifecycle,
  processNames: ComputerUseProcessName[],
): Promise<ComputerUseDiagnostics[]> {
  const diagnostics: ComputerUseDiagnostics[] = [];

  for (const processName of processNames) {
    const diagnostic: ComputerUseDiagnostics = { processName };

    try {
      const status = await computerUse.getProcessStatus?.(processName);
      const running = responseField(status, "running");
      const processStatus = responseField(status, "status");
      diagnostic.running = typeof running === "boolean" ? running : undefined;
      diagnostic.status = typeof processStatus === "string" ? processStatus : undefined;
    } catch (error) {
      diagnostic.diagnosticError = compactDiagnostic(`status: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const errors = await computerUse.getProcessErrors?.(processName);
      diagnostic.errors = compactDiagnostic(responseField(errors, "errors"));
    } catch (error) {
      diagnostic.diagnosticError = compactDiagnostic(
        [diagnostic.diagnosticError, `errors: ${error instanceof Error ? error.message : String(error)}`].filter(Boolean).join("; "),
      );
    }

    if (!diagnostic.errors) {
      try {
        const logs = await computerUse.getProcessLogs?.(processName);
        diagnostic.logs = compactDiagnostic(responseField(logs, "logs"));
      } catch (error) {
        diagnostic.diagnosticError = compactDiagnostic(
          [diagnostic.diagnosticError, `logs: ${error instanceof Error ? error.message : String(error)}`].filter(Boolean).join("; "),
        );
      }
    }

    diagnostics.push(diagnostic);
  }

  return diagnostics;
}

function formatComputerUseFailure(errors: unknown[], diagnostics: ComputerUseDiagnostics[]) {
  const attempts = Array.from(
    new Set(errors.map((error) => error instanceof Error ? error.message : String(error)).filter(Boolean)),
  ).slice(0, 4);
  const processDetails = diagnostics
    .map((diagnostic) => {
      const parts = [
        diagnostic.processName,
        diagnostic.running === undefined ? undefined : `running=${diagnostic.running}`,
        diagnostic.status ? `status=${diagnostic.status}` : undefined,
        diagnostic.errors ? `errors=${diagnostic.errors}` : undefined,
        !diagnostic.errors && diagnostic.logs ? `logs=${diagnostic.logs}` : undefined,
        diagnostic.diagnosticError ? `diagnostic=${diagnostic.diagnosticError}` : undefined,
      ].filter(Boolean);
      return parts.join(" ");
    })
    .join("; ");

  return [
    "Failed to start Daytona desktop after recovery.",
    attempts.length > 0 ? `attempts: ${attempts.join(" | ")}` : undefined,
    processDetails ? `processes: ${processDetails}` : undefined,
  ].filter(Boolean).join(" ");
}

async function recoverComputerUse(computerUse: ComputerUseLifecycle, cause: unknown) {
  const errors: unknown[] = [cause];
  const processNames = processNamesFromComputerUseError(cause);

  await computerUse.stop().catch((error) => {
    errors.push(new Error(`stop: ${error instanceof Error ? error.message : String(error)}`));
  });
  await sleep(COMPUTER_RECOVERY_DELAY_MS);

  try {
    await computerUse.start();
  } catch (error) {
    errors.push(error);
    await restartComputerUseProcesses(computerUse, processNames, errors);
  }

  try {
    await waitForComputerReady(computerUse);
  } catch (error) {
    errors.push(error);
    const diagnostics = await collectComputerUseDiagnostics(computerUse, processNames);
    throw new Error(formatComputerUseFailure(errors, diagnostics));
  }
}

async function ensureComputerReady(computerUse: ComputerUseLifecycle) {
  const currentStatus = await readComputerStatus(computerUse);

  if (currentStatus === "active") {
    return;
  }

  if (currentStatus === "partial" || currentStatus === "error") {
    await recoverComputerUse(computerUse, new Error(`Daytona desktop status is ${currentStatus}.`));
    return;
  }

  try {
    await computerUse.start();
  } catch (error) {
    if (await readComputerStatus(computerUse) === "active") {
      return;
    }
    await recoverComputerUse(computerUse, error);
    return;
  }

  try {
    await waitForComputerReady(computerUse);
  } catch (error) {
    await recoverComputerUse(computerUse, error);
  }
}

function cleanRecordingTitle(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const title = value.replace(/\s+/g, " ").trim();
  return title.length > 0 ? title : undefined;
}

function recordingTitleFromFileName(fileName: string | undefined): string | undefined {
  if (!fileName) {
    return undefined;
  }

  const baseName = fileName.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "";
  const words = baseName.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

  if (!words || /^[a-f0-9]{8,}$/i.test(words.replace(/\s+/g, ""))) {
    return undefined;
  }

  return words.replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

function recordingTitle(recording: DaytonaRecording, fileName: string | undefined, titleHint?: string) {
  return (
    cleanRecordingTitle(recording.title) ??
    cleanRecordingTitle(recording.label) ??
    cleanRecordingTitle(recording.name) ??
    cleanRecordingTitle(titleHint) ??
    recordingTitleFromFileName(fileName) ??
    "Demo Walkthrough"
  );
}

function compactRecording(
  recording: DaytonaRecording,
  titleHint?: string,
) {
  const id = typeof recording.id === "string" ? recording.id : "";
  const fileName = typeof recording.fileName === "string" ? recording.fileName : undefined;

  return {
    type: "daytona_recording",
    id,
    title: recordingTitle(recording, fileName, titleHint),
    fileName,
    filePath: typeof recording.filePath === "string" ? recording.filePath : undefined,
    status: typeof recording.status === "string" ? recording.status : undefined,
    startTime: typeof recording.startTime === "string" ? recording.startTime : undefined,
    endTime: typeof recording.endTime === "string" ? recording.endTime : undefined,
    durationSeconds: typeof recording.durationSeconds === "number" ? recording.durationSeconds : undefined,
    sizeBytes: typeof recording.sizeBytes === "number" ? recording.sizeBytes : undefined,
    contentType: "video/mp4",
  };
}

function recordingSummary(recording: ReturnType<typeof compactRecording>) {
  const parts = [`Recording "${recording.title}"`];
  if (recording.status) {
    parts.push(recording.status);
  }
  if (typeof recording.durationSeconds === "number") {
    parts.push(`${recording.durationSeconds.toFixed(1)}s`);
  }
  return parts.join(" - ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  return typeof value[key] === "number" ? value[key] : undefined;
}

function parseImageData(raw: string | undefined, fallbackMimeType = "image/png") {
  if (!raw) {
    throw new Error("CUA did not return screenshot data.");
  }

  const dataUrlMatch = raw.match(/^data:(?<mediaType>[^;]+);base64,(?<data>.+)$/s);
  if (dataUrlMatch?.groups?.data) {
    return {
      data: dataUrlMatch.groups.data,
      mimeType: dataUrlMatch.groups.mediaType ?? fallbackMimeType,
    };
  }

  return {
    data: raw,
    mimeType: fallbackMimeType,
  };
}

function screenshotOptions(input?: Extract<ComputerAction, { type: "screenshot" }>) {
  return {
    format: input?.format ?? DEFAULT_SCREENSHOT_FORMAT,
    quality: input?.quality ?? DEFAULT_SCREENSHOT_QUALITY,
  };
}

async function captureScreenshot(
  cua: CuaComputerClient,
  input?: Extract<ComputerAction, { type: "screenshot" }>,
) {
  const options = screenshotOptions(input);
  const [shot, screenSize, cursor] = await Promise.all([
    cua.command("screenshot", options),
    cua.command("get_screen_size").catch(() => undefined),
    cua.command("get_cursor_position").catch(() => undefined),
  ]);
  const size = isRecord(screenSize?.size) ? screenSize.size : undefined;
  const cursorPosition = isRecord(cursor?.position) ? cursor.position : undefined;
  const { data, mimeType } = parseImageData(
    typeof shot.image_data === "string" ? shot.image_data : undefined,
    options.format === "jpeg" ? "image/jpeg" : `image/${options.format}`,
  );
  const display = size
    ? { width: numberField(size, "width"), height: numberField(size, "height") }
    : undefined;

  return {
    screenshot: {
      data,
      mimeType,
      sizeBytes: Buffer.byteLength(data, "base64"),
      cursorPosition,
      width: display?.width,
      height: display?.height,
      format: options.format,
      quality: options.quality,
    } satisfies ScreenshotForModel,
    display,
  };
}

type DisplaySize = { width: number; height: number };

function coordinatePoints(action: ComputerAction): Array<{ x: number; y: number; label: string }> {
  switch (action.type) {
    case "move":
    case "click":
    case "double_click":
    case "scroll":
      return [{ x: action.x, y: action.y, label: action.type }];
    case "drag":
      return [
        { x: action.startX, y: action.startY, label: "drag start" },
        { x: action.endX, y: action.endY, label: "drag end" },
      ];
    default:
      return [];
  }
}

function assertCoordinatesWithinDisplay(actions: ComputerAction[], display: DisplaySize): void {
  for (const action of actions) {
    for (const point of coordinatePoints(action)) {
      if (point.x >= display.width || point.y >= display.height) {
        throw new Error(
          `CUA ${point.label} coordinate (${point.x}, ${point.y}) is outside the ${display.width}x${display.height} screenshot. Capture a fresh screenshot and use its image-space coordinates.`,
        );
      }
    }
  }
}

async function readDisplaySize(cua: CuaComputerClient): Promise<DisplaySize> {
  const result = await cua.command("get_screen_size");
  const size = isRecord(result.size) ? result.size : undefined;
  const width = size ? numberField(size, "width") : undefined;
  const height = size ? numberField(size, "height") : undefined;
  if (!width || !height || width <= 0 || height <= 0) {
    throw new Error("CUA returned an invalid desktop size.");
  }
  return { width, height };
}

function pauseReasonForCommand(command: Record<string, unknown> | undefined): string | undefined {
  const effect = command?.effect;
  if (effect === "suspected_noop") {
    return "CUA suspected that the action had no effect";
  }
  if (effect === "partial") {
    return "CUA reported only a partial action effect";
  }
  if (effect === "unverifiable") {
    return "CUA could not verify the action effect";
  }
  return undefined;
}

function requiresDaytonaDesktop(action: ComputerAction) {
  return !["status", "stop_recording", "get_recording", "list_recordings"].includes(action.type);
}

function requiresCua(action: ComputerAction) {
  // Recording remains Daytona-owned, but CUA readiness also selects exactly
  // one visible pointer: the unlabeled 0.20 overlay or the native fallback.
  // Do that before Daytona captures the first frame.
  return !["status", "stop_recording", "get_recording", "list_recordings"].includes(action.type);
}

function shouldCaptureAfter(actions: ComputerAction[]) {
  return actions.some((action) =>
    [
      "start",
      "display",
      "windows",
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
    ].includes(action.type),
  );
}

function summarizeAction(action: ComputerAction) {
  switch (action.type) {
    case "start":
    case "status":
    case "display":
    case "windows":
    case "screenshot":
    case "list_recordings":
      return action.type;
    case "wait":
      return `wait(${action.ms ?? 1000}ms)`;
    case "open_url":
      return `open_url(${action.url})`;
    case "move":
      return `move(${action.x},${action.y})`;
    case "click":
      return `click(${action.x},${action.y},${action.button ?? "left"})`;
    case "double_click":
      return `double_click(${action.x},${action.y},${action.button ?? "left"})`;
    case "drag":
      return `drag(${action.startX},${action.startY}->${action.endX},${action.endY},${action.button ?? "left"})`;
    case "scroll":
      return `scroll(${action.x},${action.y},${action.direction},${action.amount ?? 5})`;
    case "type":
      return `type(${action.text.length} chars)`;
    case "keypress":
      return `keypress(${[...(action.modifiers ?? []), action.key].join("+")})`;
    case "hotkey":
      return `hotkey(${action.keys})`;
    case "start_recording":
      return `start_recording(${action.title})`;
    case "stop_recording":
      return `${action.type}(${action.recordingId}, ${action.title})`;
    case "get_recording":
      return `${action.type}(${action.recordingId})`;
  }
}

function legacyToAction(input: z.infer<typeof legacyActionSchema>): unknown {
  const action = input.action ?? input.type;

  switch (action) {
    case "start":
    case "status":
    case "display":
    case "windows":
    case "list_recordings":
      return { type: action };
    case "open_url":
      return { type: "open_url", url: input.url };
    case "screenshot":
      return {
        type: "screenshot",
        format: input.format,
        quality: input.quality,
      };
    case "wait":
      return { type: "wait", ms: input.ms };
    case "move":
    case "move_mouse":
    case "mouse_move":
      return { type: "move", x: input.x, y: input.y };
    case "click":
      return {
        type: input.double ? "double_click" : "click",
        x: input.x,
        y: input.y,
        button: input.button,
      };
    case "double_click":
      return {
        type: "double_click",
        x: input.x,
        y: input.y,
        button: input.button,
      };
    case "drag":
      const firstPoint = input.path?.[0];
      const lastPoint = input.path?.at(-1);
      return {
        type: "drag",
        startX: Array.isArray(firstPoint) ? firstPoint[0] : firstPoint?.x ?? input.startX,
        startY: Array.isArray(firstPoint) ? firstPoint[1] : firstPoint?.y ?? input.startY,
        endX: Array.isArray(lastPoint) ? lastPoint[0] : lastPoint?.x ?? input.endX,
        endY: Array.isArray(lastPoint) ? lastPoint[1] : lastPoint?.y ?? input.endY,
        button: input.button,
      };
    case "scroll": {
      const scrollX = input.scrollX ?? input.scroll_x ?? 0;
      const scrollY = input.scrollY ?? input.scroll_y ?? 0;
      const useVertical = Math.abs(scrollY) >= Math.abs(scrollX);
      const delta = useVertical ? scrollY : scrollX;
      return {
        type: "scroll",
        x: input.x,
        y: input.y,
        direction: input.direction ?? (useVertical
          ? delta >= 0 ? "down" : "up"
          : delta >= 0 ? "right" : "left"),
        amount: input.amount ?? (delta === 0
          ? undefined
          : Math.min(20, Math.max(1, Math.ceil(Math.abs(delta) / 100)))),
      };
    }
    case "type":
    case "type_text":
      return { type: "type", text: input.text, delayMs: input.delayMs ?? input.delay };
    case "keypress":
    case "press_key":
      if (Array.isArray(input.keys)) {
        return { type: "hotkey", keys: input.keys.join("+") };
      }
      return { type: "keypress", key: input.key, modifiers: input.modifiers };
    case "hotkey":
      return {
        type: "hotkey",
        keys: Array.isArray(input.keys) ? input.keys.join("+") : input.keys,
      };
    case "start_recording":
      return { type: "start_recording", title: input.title ?? input.label };
    case "stop_recording":
      return { type: "stop_recording", recordingId: input.recordingId, title: input.title ?? input.label };
    case "get_recording":
      return { type: "get_recording", recordingId: input.recordingId };
    default:
      return input;
  }
}

function compactDetailsForMetadata(details: ComputerOutputDetails): ComputerOutputDetails {
  if (!details.screenshot?.data) {
    return details;
  }

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
    {
      type: "text",
      text: `${COMPUTER_METADATA_PREFIX}${JSON.stringify(compactDetailsForMetadata(details))}`,
    },
  ];

  if (details.screenshot?.data) {
    const image = {
      type: "image-data",
      mediaType: details.screenshot.mimeType,
    } as { type: "image-data"; data: string; mediaType: string };

    // Trigger.dev chat sessions serialize each tool output into one realtime
    // record with a ~1 MiB cap. The screenshot is only needed by the model;
    // the chat UI and persisted message use the compact metadata above.
    // Keeping the bytes non-enumerable lets AI SDK's toModelOutput read them
    // in-process without putting the base64 payload on the realtime wire.
    Object.defineProperty(image, "data", {
      configurable: false,
      enumerable: false,
      value: details.screenshot.data,
      writable: false,
    });
    value.push(image);
  }

  return {
    type: "content" as const,
    value,
  };
}

async function runOneAction(
  action: ComputerAction,
  context: Awaited<ReturnType<typeof getSandboxContext>>,
  cua: CuaComputerClient,
): Promise<Partial<ComputerOutputDetails>> {
  const { computerUse } = context.sandbox;

  switch (action.type) {
    case "start": {
      await ensureComputerReady(computerUse);
      await cua.ensureReady();
      const status = compactMetadataValue({
        status: "active",
        provider: "cua",
        server: await cua.inspect(),
        daytonaDesktop: await computerUse.getStatus(),
      });
      return { status };
    }
    case "status": {
      let server: unknown;
      try {
        server = await cua.inspect();
      } catch (error) {
        server = {
          status: "unavailable",
          error: compactDiagnostic(error instanceof Error ? error.message : String(error)),
        };
      }
      const status = compactMetadataValue({
        status: isRecord(server) && server.status === "ok" ? "active" : "inactive",
        provider: "cua",
        server,
        daytonaDesktop: await computerUse.getStatus(),
      });
      return { status };
    }
    case "display": {
      const result = await cua.command("get_screen_size");
      const size = isRecord(result.size) ? result.size : {};
      const display = {
        width: numberField(size, "width"),
        height: numberField(size, "height"),
      };
      return { display };
    }
    case "windows": {
      try {
        const current = await cua.command("get_current_window_id");
        const windowId = current.window_id;
        if (typeof windowId !== "string" && typeof windowId !== "number") {
          return { windows: [] };
        }
        const [name, size, position] = await Promise.all([
          cua.command("get_window_name", { window_id: windowId }),
          cua.command("get_window_size", { window_id: windowId }),
          cua.command("get_window_position", { window_id: windowId }),
        ]);
        return {
          windows: [{
            id: windowId,
            name: name.name,
            width: size.width,
            height: size.height,
            x: position.x,
            y: position.y,
            active: true,
          }],
        };
      } catch {
        return { windows: [] };
      }
    }
    case "open_url": {
      const result = await cua.command("open", { target: action.url });
      await sleep(2_000);
      return commandDetails(result);
    }
    case "screenshot":
      return {};
    case "wait":
      await sleep(action.ms ?? 1000);
      return {};
    case "move": {
      return commandDetails(await cua.command("move_cursor", { x: action.x, y: action.y }));
    }
    case "click": {
      let result: Record<string, unknown>;
      if (action.button === "middle") {
        await cua.command("mouse_down", { x: action.x, y: action.y, button: "middle" });
        result = await cua.command("mouse_up", { x: action.x, y: action.y, button: "middle" });
      } else {
        result = await cua.command(action.button === "right" ? "right_click" : "left_click", {
          x: action.x,
          y: action.y,
        });
      }
      return commandDetails(result);
    }
    case "double_click": {
      let result: Record<string, unknown> | undefined;
      if (action.button === "middle") {
        for (let index = 0; index < 2; index += 1) {
          await cua.command("mouse_down", { x: action.x, y: action.y, button: "middle" });
          result = await cua.command("mouse_up", { x: action.x, y: action.y, button: "middle" });
        }
      } else {
        const command = action.button === "right" ? "right_click" : "double_click";
        result = await cua.command(command, { x: action.x, y: action.y });
        if (command !== "double_click") {
          result = await cua.command(command, { x: action.x, y: action.y });
        }
      }
      if (!result) throw new Error("CUA double-click returned no action result.");
      return commandDetails(result);
    }
    case "drag": {
      return commandDetails(await cua.command("drag", {
        path: [[action.startX, action.startY], [action.endX, action.endY]],
        button: action.button ?? "left",
        duration: 0.5,
      }));
    }
    case "scroll": {
      await cua.command("move_cursor", { x: action.x, y: action.y });
      return commandDetails(await cua.command("scroll_direction", {
        direction: action.direction,
        clicks: action.amount ?? 5,
      }));
    }
    case "type": {
      if (!action.delayMs) {
        return commandDetails(await cua.command("type_text", { text: action.text }));
      }

      // The pinned CUA protocol has no delay field, so pace the existing
      // type_text command without sending unsupported parameters to the server.
      const characters = Array.from(action.text);
      let result: CuaCommandResponse | undefined;
      for (const [index, character] of characters.entries()) {
        result = await cua.command("type_text", { text: character });
        if (index < characters.length - 1) await sleep(action.delayMs);
      }
      return commandDetails(result ?? { success: true });
    }
    case "keypress": {
      const modifiers = action.modifiers?.map((modifier) => (modifier === "cmd" ? "meta" : modifier));
      if (modifiers?.length) {
        return commandDetails(await cua.command("hotkey", { keys: [...modifiers, action.key] }));
      }
      return commandDetails(await cua.command("press_key", { key: action.key }));
    }
    case "hotkey": {
      const keys = action.keys
        .split("+")
        .map((key) => key.trim().toLowerCase())
        .filter(Boolean)
        .map((key) => key === "cmd" ? "meta" : key);
      if (keys.length === 0) {
        throw new Error("CUA hotkey requires at least one key.");
      }
      return commandDetails(await cua.command("hotkey", { keys }));
    }
    case "start_recording": {
      const recording = compactRecording(
        await computerUse.recording.start(action.title) as DaytonaRecording,
        action.title,
      );
      return { recording, recordings: [recording] };
    }
    case "stop_recording": {
      const recording = compactRecording(
        await computerUse.recording.stop(action.recordingId) as DaytonaRecording,
        action.title,
      );
      return { recording, recordings: [recording] };
    }
    case "get_recording": {
      const recording = compactRecording(
        await computerUse.recording.get(action.recordingId) as DaytonaRecording,
      );
      return { recording, recordings: [recording] };
    }
    case "list_recordings": {
      const result = await computerUse.recording.list();
      const allRecordings = isRecord(result) && Array.isArray(result.recordings)
        ? result.recordings
        : [];
      return {
        recordings: allRecordings
          .slice(0, MAX_RECORDINGS_RETURNED)
          .map((recording) => compactRecording(recording as DaytonaRecording)),
        recordingsTruncated: allRecordings.length > MAX_RECORDINGS_RETURNED,
      };
    }
  }
}

async function executeCuaComputer(
  input: ComputerInput,
  sandboxOptions: SandboxSessionOptions,
  computerOptions: CuaComputerToolOptions,
) {
  if (
    computerOptions.recordingEnabled !== true
    && input.actions.some((action) => action.type === "start_recording")
  ) {
    throw new Error(
      "Demo recording is disabled for this thread. Enable demo mode before starting a screen recording.",
    );
  }

  const context = await getSandboxContext(sandboxOptions);
  const { computerUse } = context.sandbox;
  return serializeComputerOperations(computerUse, (track) => executeCuaComputerActions(
    input,
    context,
    sandboxOptions,
    computerOptions,
    track,
  ));
}

async function executeCuaComputerActions(
  input: ComputerInput,
  context: Awaited<ReturnType<typeof getSandboxContext>>,
  sandboxOptions: SandboxSessionOptions,
  computerOptions: CuaComputerToolOptions,
  track: TrackComputerOperation,
) {
  const { computerUse } = context.sandbox;
  const cua = new CuaComputerClient(context.sandbox, sandboxOptions, computerOptions);
  const summaries = input.actions.map(summarizeAction);
  const details: ComputerOutputDetails = {
    action: input.actions.length === 1 ? input.actions[0]?.type : undefined,
    actions: summaries,
  };
  const recordings: Array<ReturnType<typeof compactRecording>> = [];
  const needsCua = input.actions.some(requiresCua);
  let cursor: CuaAgentCursorStatus | undefined;

  if (input.actions.some(requiresDaytonaDesktop)) {
    await runBoundedComputerOperation(
      track,
      async () => {
        await ensureComputerReady(computerUse);
        if (needsCua) {
          cursor = (await cua.ensureReady()).cursor;
        }
      },
      () => new Error(
        needsCua
          ? "Timed out waiting for the Daytona desktop and CUA computer-server to become ready."
          : "Timed out waiting for the Daytona desktop to become ready.",
      ),
      COMPUTER_START_TIMEOUT_MS,
    );
  }

  details.cursor = cursor;

  if (input.actions.some((action) => coordinatePoints(action).length > 0)) {
    const display = await runBoundedComputerOperation(
      track,
      () => readDisplaySize(cua),
      () => new Error("Timed out validating CUA screenshot coordinates."),
    );
    assertCoordinatesWithinDisplay(input.actions, display);
    details.display = display;
  }

  const completedActions: string[] = [];
  for (const [index, action] of input.actions.entries()) {
    const partial = await runBoundedComputerOperation(
      track,
      () => runOneAction(action, context, cua),
      () => new Error(`Timed out running CUA computer action ${action.type}.`),
    );

    if (partial.status !== undefined) {
      details.status = partial.status;
    }
    if (partial.display !== undefined) {
      details.display = partial.display;
    }
    if (partial.windows !== undefined) {
      details.windows = partial.windows;
    }
    if (partial.command !== undefined) {
      details.command = partial.command;
    }
    if (partial.recording !== undefined) {
      details.recording = partial.recording;
    }
    if (partial.recordings?.length) {
      recordings.push(...partial.recordings);
    }
    if (partial.recordingsTruncated) {
      details.recordingsTruncated = true;
    }

    completedActions.push(summaries[index] ?? action.type);
    const pauseReason = pauseReasonForCommand(partial.command);
    if (pauseReason && index < input.actions.length - 1) {
      details.pauseReason = `${pauseReason}; the remaining actions were not run so the next screenshot can be inspected first.`;
      details.remainingActions = summaries.slice(index + 1);
      break;
    }
  }

  details.completedActions = completedActions;

  if (recordings.length > 0) {
    details.recordings = recordings;
  }

  const requestedScreenshot = input.actions.find(
    (action): action is Extract<ComputerAction, { type: "screenshot" }> => action.type === "screenshot",
  );
  if (shouldCaptureAfter(input.actions)) {
    const captured = await runBoundedComputerOperation(
      track,
      () => captureScreenshot(cua, requestedScreenshot),
      () => new Error("Timed out capturing the CUA desktop screenshot."),
    );
    details.screenshot = captured.screenshot;
    details.display = details.display ?? captured.display;
  }

  const contentLines = [
    `Actions: ${summaries.join(" -> ")}`,
    details.display
      ? `Display: ${details.display.width ?? "?"}x${details.display.height ?? "?"}`
      : undefined,
    details.screenshot
      ? `Screenshot: ${details.screenshot.mimeType}, ${details.screenshot.sizeBytes ?? details.screenshot.data?.length ?? "unknown"} bytes`
      : undefined,
    details.pauseReason ? `Batch paused: ${details.pauseReason}` : undefined,
    details.remainingActions?.length
      ? `Not run: ${details.remainingActions.join(" -> ")}`
      : undefined,
    details.recording ? recordingSummary(details.recording) : undefined,
    details.cursor
      ? details.cursor.enabled
        ? `Agent cursor: official animated overlay (${details.cursor.theme ?? "configured CUA theme"}, ${details.cursor.labelVisible ? "labeled" : "unlabeled"} ${details.cursor.implicit ? "implicit" : "explicit"} session)`
        : details.cursor.available
          ? `Agent cursor overlay: disabled; native desktop pointer active${details.cursor.error ? ` (${details.cursor.error})` : ""}`
          : `Agent cursor: unavailable${details.cursor.reason ? ` (${details.cursor.reason})` : details.cursor.error ? ` (${details.cursor.error})` : ""}`
      : undefined,
    typeof details.command?.effect === "string"
      ? `CUA action effect: ${details.command.effect}` +
        (["suspected_noop", "partial", "unverifiable"].includes(details.command.effect)
          ? " (inspect the screenshot before continuing)"
          : "")
      : undefined,
    !details.recording && details.recordings
      ? `Found ${details.recordings.length} demo recording${details.recordings.length === 1 ? "" : "s"}` +
        (details.recordingsTruncated ? ` (showing first ${MAX_RECORDINGS_RETURNED})` : "")
      : undefined,
    statusValue(details.status) ? `Status: ${statusValue(details.status)}` : undefined,
  ].filter(Boolean);

  return computerContentOutput(contentLines.join("\n"), details);
}

export function createCuaComputerTool(
  sandboxOptions: SandboxSessionOptions,
  computerOptions: CuaComputerToolOptions = {},
) {
  const recordingDescription = computerOptions.recordingEnabled === true
    ? "Demo recordings are enabled and backed by Daytona."
    : "Screen recording is disabled for this thread; CUA browser testing and GUI interaction remain available.";

  return tool<ComputerInput, Awaited<ReturnType<typeof executeCuaComputer>>>({
    title: "computer",
    description: `Inspect and operate the Daytona Linux desktop through CUA for HTTP(S) browser previews, screenshots, and GUI interaction. ${recordingDescription} Coordinates are image-space pixels from the latest returned screenshot, with (0,0) at its top-left. Accepts up to eight ordered actions, including OpenAI-style drag paths, scroll deltas, and key arrays; validates coordinate bounds, pauses uncertain batches, recovers partial desktop services, and returns a fresh screenshot when screen state matters. Follow look, act, verify: keep batches small and never reuse coordinates after navigation, scrolling, dialogs, menus, or layout changes.`,
    inputSchema: computerInputSchema,
    toModelOutput: ({ output }) => output,
    execute: (input) => executeCuaComputer(input, sandboxOptions, computerOptions),
  });
}
