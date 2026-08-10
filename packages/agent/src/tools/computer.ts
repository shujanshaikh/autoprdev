import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { executeSandboxCommand } from "../sandbox/execute";
import { raceWithTimeout } from "./timeout";

export const COMPUTER_METADATA_PREFIX = "AUTOPR_COMPUTER_METADATA ";

const COMPUTER_READY_TIMEOUT_MS = 30_000;
const COMPUTER_READY_POLL_MS = 1_000;
const COMPUTER_RECOVERY_DELAY_MS = 1_000;
const MAX_COMPUTER_DIAGNOSTIC_LENGTH = 400;
const DEFAULT_DISPLAY = ":1";
const DEFAULT_SCREENSHOT_FORMAT = "png";
const DEFAULT_SCREENSHOT_QUALITY = 100;
const DEFAULT_SCREENSHOT_SCALE = 1;
const MAX_COMPUTER_METADATA_CHARS = 8_000;
const MAX_RECORDINGS_RETURNED = 25;
const COMPUTER_ACTION_TIMEOUT_MS = 120_000;
const COMPUTER_USE_PROCESS_NAMES = ["xvfb", "xfce4", "x11vnc", "novnc"] as const;

const mouseButtonSchema = z.enum(["left", "right", "middle"]);
const modifierSchema = z.enum(["ctrl", "alt", "meta", "cmd", "shift"]);
const screenCoordinateSchema = z.number().int().min(0).max(100_000);
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
  width: z.number().int().min(1).max(10_000),
  height: z.number().int().min(1).max(10_000),
});

const screenshotOptionsSchema = {
  showCursor: z.boolean().optional().describe("Whether to show the cursor in the screenshot."),
  format: z.enum(["jpeg", "png", "webp"]).optional().describe("Compressed screenshot format."),
  quality: z.number().int().min(1).max(100).optional().describe("Compression quality for lossy formats."),
  scale: z.number().min(0.1).max(1).optional().describe("Scale factor for the screenshot."),
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
    type: z.literal("start").describe("Start the Daytona desktop/computer-use services."),
  }),
  z.object({
    type: z.literal("status").describe("Read the Daytona desktop/computer-use service status."),
  }),
  z.object({
    type: z.literal("display").describe("Read display information."),
  }),
  z.object({
    type: z.literal("windows").describe("List visible desktop windows."),
  }),
  z.object({
    type: z.literal("open_url").describe("Open a URL in the sandbox desktop browser."),
    url: browserUrlSchema.describe("Absolute HTTP(S) URL to open, usually a localhost preview chosen after inspecting the app."),
  }),
  z.object({
    type: z.literal("screenshot").describe("Capture the current desktop state."),
    region: screenshotRegionSchema.optional().describe("Optional screen region to capture."),
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
    direction: z.enum(["up", "down"]),
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
  region: screenshotRegionSchema.optional(),
  ...screenshotOptionsSchema,
  x: screenCoordinateSchema.optional(),
  y: screenCoordinateSchema.optional(),
  button: mouseButtonSchema.optional(),
  double: z.boolean().optional(),
  startX: screenCoordinateSchema.optional(),
  startY: screenCoordinateSchema.optional(),
  endX: screenCoordinateSchema.optional(),
  endY: screenCoordinateSchema.optional(),
  direction: z.enum(["up", "down"]).optional(),
  amount: z.number().int().min(1).max(20).optional(),
  ms: z.number().int().min(100).max(10_000).optional(),
  text: z.string().max(64 * 1024).optional(),
  delay: z.number().int().min(0).max(1000).optional(),
  delayMs: z.number().int().min(0).max(1000).optional(),
  key: z.string().min(1).max(128).optional(),
  modifiers: z.array(modifierSchema).max(8).optional(),
  keys: z.string().min(1).max(256).optional(),
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

export interface DaytonaComputerToolOptions {
  display?: string;
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
  region?: { x: number; y: number; width: number; height: number };
  format: string;
  quality: number;
  scale: number;
  showCursor: boolean;
};

type ScreenshotMetadata = Omit<ScreenshotForModel, "data"> & {
  data?: string;
  payloadLength?: number;
  payloadStripped?: boolean;
};

type ComputerOutputDetails = {
  action?: string;
  actions?: string[];
  display?: { x?: number; y?: number; width?: number; height?: number };
  status?: unknown;
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

function openUrlCommand() {
  return [
    "set -eu",
    "mkdir -p /tmp/autopr-cua-browser",
    'export DISPLAY="${DISPLAY:-:1}"',
    'export NO_AT_BRIDGE="${NO_AT_BRIDGE:-1}"',
    'export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-$(id -u)}"',
    'mkdir -p "$XDG_RUNTIME_DIR"',
    'chmod 700 "$XDG_RUNTIME_DIR"',
    'BROWSER="$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser || command -v firefox || command -v xdg-open || true)"',
    'if [ -z "$BROWSER" ]; then',
    '  echo "No supported graphical browser launcher found" >&2',
    "  exit 127",
    "fi",
    'case "$(basename "$BROWSER")" in',
    "  chromium*|google-chrome*)",
    '    nohup "$BROWSER" \\',
    "      --disable-dev-shm-usage \\",
    "      --no-first-run \\",
    "      --force-renderer-accessibility \\",
    "      --user-data-dir=/tmp/autopr-cua-browser/profile \\",
    '      --new-window "$CUA_URL" >/tmp/autopr-cua-browser/browser.log 2>&1 &',
    "    ;;",
    "  firefox*)",
    '    nohup "$BROWSER" --new-window "$CUA_URL" >/tmp/autopr-cua-browser/browser.log 2>&1 &',
    "    ;;",
    "  *)",
    '    nohup "$BROWSER" "$CUA_URL" >/tmp/autopr-cua-browser/browser.log 2>&1 &',
    "    ;;",
    "esac",
    'echo "launched $BROWSER"',
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  return typeof value[key] === "number" ? value[key] : undefined;
}

function activeDisplayInfo(displayInfo: unknown): { x?: number; y?: number; width?: number; height?: number } | undefined {
  if (!isRecord(displayInfo) || !Array.isArray(displayInfo.displays)) {
    return undefined;
  }

  const displays = displayInfo.displays.filter(isRecord);
  const display = displays.find((item) => item.isActive === true) ?? displays[0];
  if (!display) {
    return undefined;
  }

  return {
    x: numberField(display, "x"),
    y: numberField(display, "y"),
    width: numberField(display, "width"),
    height: numberField(display, "height"),
  };
}

function parseImageData(raw: string | undefined, fallbackMimeType = "image/png") {
  if (!raw) {
    throw new Error("Daytona did not return screenshot data.");
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
    showCursor: input?.showCursor ?? true,
    format: input?.format ?? DEFAULT_SCREENSHOT_FORMAT,
    quality: input?.quality ?? DEFAULT_SCREENSHOT_QUALITY,
    scale: input?.scale ?? DEFAULT_SCREENSHOT_SCALE,
  };
}

async function captureScreenshot(
  computerUse: {
    screenshot: {
      takeCompressed(options?: {
        showCursor?: boolean;
        format?: string;
        quality?: number;
        scale?: number;
      }): Promise<unknown>;
      takeCompressedRegion(
        region: { x: number; y: number; width: number; height: number },
        options?: {
          showCursor?: boolean;
          format?: string;
          quality?: number;
          scale?: number;
        },
      ): Promise<unknown>;
    };
    display: {
      getInfo(): Promise<unknown>;
    };
  },
  input?: Extract<ComputerAction, { type: "screenshot" }>,
) {
  const options = screenshotOptions(input);
  const [shot, displayInfo] = await Promise.all([
    input?.region
      ? computerUse.screenshot.takeCompressedRegion(input.region, options)
      : computerUse.screenshot.takeCompressed(options),
    computerUse.display.getInfo().catch(() => undefined),
  ]);
  const response = isRecord(shot) ? shot : {};
  const { data, mimeType } = parseImageData(
    typeof response.screenshot === "string" ? response.screenshot : undefined,
    options.format === "jpeg" ? "image/jpeg" : `image/${options.format}`,
  );
  const display = activeDisplayInfo(displayInfo);

  return {
    screenshot: {
      data,
      mimeType,
      sizeBytes: typeof response.sizeBytes === "number" ? response.sizeBytes : undefined,
      cursorPosition: response.cursorPosition,
      width: display?.width,
      height: display?.height,
      region: input?.region,
      format: options.format,
      quality: options.quality,
      scale: options.scale,
      showCursor: options.showCursor,
    } satisfies ScreenshotForModel,
    display,
  };
}

function requiresDesktop(action: ComputerAction) {
  return !["status", "get_recording", "list_recordings"].includes(action.type);
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
        region: input.region,
        showCursor: input.showCursor,
        format: input.format,
        quality: input.quality,
        scale: input.scale,
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
      return {
        type: "drag",
        startX: input.startX,
        startY: input.startY,
        endX: input.endX,
        endY: input.endY,
        button: input.button,
      };
    case "scroll":
      return {
        type: "scroll",
        x: input.x,
        y: input.y,
        direction: input.direction,
        amount: input.amount,
      };
    case "type":
    case "type_text":
      return { type: "type", text: input.text, delayMs: input.delayMs ?? input.delay };
    case "keypress":
    case "press_key":
      return { type: "keypress", key: input.key, modifiers: input.modifiers };
    case "hotkey":
      return { type: "hotkey", keys: input.keys };
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
  computerOptions: DaytonaComputerToolOptions,
): Promise<Partial<ComputerOutputDetails>> {
  const { sandbox, workDir } = context;
  const { computerUse } = sandbox;

  switch (action.type) {
    case "start": {
      await ensureComputerReady(computerUse);
      const status = compactMetadataValue(await computerUse.getStatus());
      return { status };
    }
    case "status": {
      const status = compactMetadataValue(await computerUse.getStatus());
      return { status };
    }
    case "display": {
      const display = activeDisplayInfo(await computerUse.display.getInfo());
      return { display };
    }
    case "windows": {
      return { windows: compactMetadataValue(await computerUse.display.getWindows()) };
    }
    case "open_url": {
      const result = await executeSandboxCommand(openUrlCommand(), {
        cwd: workDir,
        timeout: 15,
        env: {
          CUA_URL: action.url,
          DISPLAY: computerOptions.display ?? process.env.DAYTONA_DISPLAY ?? DEFAULT_DISPLAY,
        },
        sandboxOptions: {
          cacheKey: context.sandbox.id,
          sandboxId: context.sandbox.id,
        },
      });

      if (typeof result.exitCode === "number" && result.exitCode !== 0) {
        throw new Error(result.stderr || result.stdout || `Could not open ${action.url} in the Daytona desktop browser.`);
      }

      await sleep(2_000);
      return {
        windows: compactMetadataValue(await computerUse.display.getWindows().catch(() => undefined)),
        command: {
          cwd: result.cwd,
          exitCode: result.exitCode ?? null,
          stdout: compactDiagnostic(result.stdout ?? result.output ?? ""),
          stderr: compactDiagnostic(result.stderr ?? ""),
        },
      };
    }
    case "screenshot":
      return {};
    case "wait":
      await sleep(action.ms ?? 1000);
      return {};
    case "move": {
      await computerUse.mouse.move(action.x, action.y);
      return {};
    }
    case "click": {
      await computerUse.mouse.click(action.x, action.y, action.button ?? "left");
      return {};
    }
    case "double_click": {
      await computerUse.mouse.click(action.x, action.y, action.button ?? "left", true);
      return {};
    }
    case "drag": {
      await computerUse.mouse.drag(action.startX, action.startY, action.endX, action.endY, action.button ?? "left");
      return {};
    }
    case "scroll": {
      await computerUse.mouse.scroll(action.x, action.y, action.direction, action.amount ?? 5);
      return {};
    }
    case "type": {
      await computerUse.keyboard.type(action.text, action.delayMs ?? 0);
      return {};
    }
    case "keypress": {
      const modifiers = action.modifiers?.map((modifier) => (modifier === "cmd" ? "meta" : modifier));
      await computerUse.keyboard.press(action.key, modifiers);
      return {};
    }
    case "hotkey": {
      await computerUse.keyboard.hotkey(action.keys);
      return {};
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

async function executeDaytonaComputer(
  input: ComputerInput,
  sandboxOptions: SandboxSessionOptions,
  computerOptions: DaytonaComputerToolOptions,
) {
  const context = await getSandboxContext(sandboxOptions);
  const { computerUse } = context.sandbox;
  const summaries = input.actions.map(summarizeAction);
  const details: ComputerOutputDetails = {
    action: input.actions.length === 1 ? input.actions[0]?.type : undefined,
    actions: summaries,
  };
  const recordings: Array<ReturnType<typeof compactRecording>> = [];

  if (input.actions.some(requiresDesktop)) {
    await raceWithTimeout(
      () => ensureComputerReady(computerUse),
      COMPUTER_ACTION_TIMEOUT_MS,
      () => new Error("Timed out waiting for the Daytona desktop to become ready."),
    );
  }

  for (const action of input.actions) {
    const partial = await raceWithTimeout(
      () => runOneAction(action, context, computerOptions),
      COMPUTER_ACTION_TIMEOUT_MS,
      () => new Error(`Timed out running Daytona computer action ${action.type}.`),
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
  }

  if (recordings.length > 0) {
    details.recordings = recordings;
  }

  const requestedScreenshot = input.actions.find(
    (action): action is Extract<ComputerAction, { type: "screenshot" }> => action.type === "screenshot",
  );
  if (shouldCaptureAfter(input.actions)) {
    const captured = await raceWithTimeout(
      () => captureScreenshot(computerUse, requestedScreenshot),
      COMPUTER_ACTION_TIMEOUT_MS,
      () => new Error("Timed out capturing the Daytona desktop screenshot."),
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
    details.recording ? recordingSummary(details.recording) : undefined,
    !details.recording && details.recordings
      ? `Found ${details.recordings.length} demo recording${details.recordings.length === 1 ? "" : "s"}` +
        (details.recordingsTruncated ? ` (showing first ${MAX_RECORDINGS_RETURNED})` : "")
      : undefined,
    statusValue(details.status) ? `Status: ${statusValue(details.status)}` : undefined,
  ].filter(Boolean);

  return computerContentOutput(contentLines.join("\n"), details);
}

export function createDaytonaComputerTool(
  sandboxOptions: SandboxSessionOptions,
  computerOptions: DaytonaComputerToolOptions = {},
) {
  return tool<ComputerInput, Awaited<ReturnType<typeof executeDaytonaComputer>>>({
    title: "computer",
    description:
      "Inspect and operate the Daytona desktop for HTTP(S) browser previews, screenshots, GUI interaction, and demo recordings. Accepts up to eight ordered actions, bounds each action and metadata payload, recovers partial desktop services, and returns a fresh screenshot when screen state matters. Mutates GUI/recording state; keep batches small and re-check before coordinate-sensitive actions.",
    inputSchema: computerInputSchema,
    toModelOutput: ({ output }) => output,
    execute: (input) => executeDaytonaComputer(input, sandboxOptions, computerOptions),
  });
}
