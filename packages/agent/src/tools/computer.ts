import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { executeSandboxCommand } from "../sandbox/execute";

export const COMPUTER_METADATA_PREFIX = "AUTOPR_COMPUTER_METADATA ";

const COMPUTER_READY_TIMEOUT_MS = 30_000;
const COMPUTER_READY_POLL_MS = 1_000;
const DEFAULT_DISPLAY = ":1";
const DEFAULT_SCREENSHOT_FORMAT = "png";
const DEFAULT_SCREENSHOT_QUALITY = 100;
const DEFAULT_SCREENSHOT_SCALE = 1;

const mouseButtonSchema = z.enum(["left", "right", "middle"]);
const modifierSchema = z.enum(["ctrl", "alt", "meta", "cmd", "shift"]);

const screenshotRegionSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
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
    url: z.string().min(1).describe("URL to open, usually a localhost preview URL chosen after inspecting the app."),
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
    x: z.number().int().min(0),
    y: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("click").describe("Click absolute screen coordinates."),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    button: mouseButtonSchema.optional(),
  }),
  z.object({
    type: z.literal("double_click").describe("Double-click absolute screen coordinates."),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    button: mouseButtonSchema.optional(),
  }),
  z.object({
    type: z.literal("drag").describe("Drag from one absolute screen coordinate to another."),
    startX: z.number().int().min(0),
    startY: z.number().int().min(0),
    endX: z.number().int().min(0),
    endY: z.number().int().min(0),
    button: mouseButtonSchema.optional(),
  }),
  z.object({
    type: z.literal("scroll").describe("Scroll at absolute screen coordinates."),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    direction: z.enum(["up", "down"]),
    amount: z.number().int().min(1).max(20).optional(),
  }),
  z.object({
    type: z.literal("type").describe("Type text into the focused desktop app."),
    text: z.string().min(1),
    delayMs: z.number().int().min(0).max(1000).optional(),
  }),
  z.object({
    type: z.literal("keypress").describe("Press one key with optional modifiers."),
    key: z.string().min(1),
    modifiers: z.array(modifierSchema).optional(),
  }),
  z.object({
    type: z.literal("hotkey").describe("Press a single atomic hotkey chord such as ctrl+l or alt+tab."),
    keys: z.string().min(1),
  }),
  z.object({
    type: z.literal("start_recording").describe("Start a desktop recording."),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("stop_recording").describe("Stop a desktop recording by ID."),
    recordingId: z.string().min(1),
  }),
  z.object({
    type: z.literal("get_recording").describe("Get metadata for one desktop recording."),
    recordingId: z.string().min(1),
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
  url: z.string().min(1).optional(),
  region: screenshotRegionSchema.optional(),
  ...screenshotOptionsSchema,
  x: z.number().int().min(0).optional(),
  y: z.number().int().min(0).optional(),
  button: mouseButtonSchema.optional(),
  double: z.boolean().optional(),
  startX: z.number().int().min(0).optional(),
  startY: z.number().int().min(0).optional(),
  endX: z.number().int().min(0).optional(),
  endY: z.number().int().min(0).optional(),
  direction: z.enum(["up", "down"]).optional(),
  amount: z.number().int().min(1).max(20).optional(),
  ms: z.number().int().min(100).max(10_000).optional(),
  text: z.string().optional(),
  delay: z.number().int().min(0).max(1000).optional(),
  delayMs: z.number().int().min(0).max(1000).optional(),
  key: z.string().min(1).optional(),
  modifiers: z.array(modifierSchema).optional(),
  keys: z.string().min(1).optional(),
  label: z.string().optional(),
  recordingId: z.string().min(1).optional(),
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
  recordingBasePath?: string;
  display?: string;
}

type DaytonaRecording = {
  id?: unknown;
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
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusValue(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const status = (value as { status?: unknown }).status;
  return typeof status === "string" ? status : undefined;
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
  getStatus(): Promise<unknown>;
};

async function readComputerStatus(computerUse: Pick<ComputerUseLifecycle, "getStatus">): Promise<string | undefined> {
  try {
    return statusValue(await computerUse.getStatus());
  } catch {
    return undefined;
  }
}

async function ensureComputerReady(computerUse: ComputerUseLifecycle) {
  const currentStatus = await readComputerStatus(computerUse);
  if (currentStatus !== "active") {
    await computerUse.start();
  }

  await waitForComputerReady(computerUse);
}

function appendQuery(url: string, key: string, value: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function recordingUrl(options: DaytonaComputerToolOptions, recordingId: string): string | undefined {
  return options.recordingBasePath ? appendQuery(options.recordingBasePath, "recordingId", recordingId) : undefined;
}

function compactRecording(recording: DaytonaRecording, options: DaytonaComputerToolOptions) {
  const id = typeof recording.id === "string" ? recording.id : "";
  const url = id ? recordingUrl(options, id) : undefined;

  return {
    type: "daytona_recording",
    id,
    fileName: typeof recording.fileName === "string" ? recording.fileName : undefined,
    filePath: typeof recording.filePath === "string" ? recording.filePath : undefined,
    status: typeof recording.status === "string" ? recording.status : undefined,
    startTime: typeof recording.startTime === "string" ? recording.startTime : undefined,
    endTime: typeof recording.endTime === "string" ? recording.endTime : undefined,
    durationSeconds: typeof recording.durationSeconds === "number" ? recording.durationSeconds : undefined,
    sizeBytes: typeof recording.sizeBytes === "number" ? recording.sizeBytes : undefined,
    url,
    contentType: "video/mp4",
  };
}

function recordingSummary(recording: ReturnType<typeof compactRecording>) {
  const parts = [`Recording ${recording.id || "unknown"}`];
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
    'BROWSER="$(command -v chromium || command -v chromium-browser || command -v google-chrome || command -v google-chrome-stable || command -v firefox || command -v xdg-open || true)"',
    'if [ -z "$BROWSER" ]; then',
    '  echo "No supported graphical browser launcher found" >&2',
    "  exit 127",
    "fi",
    'case "$(basename "$BROWSER")" in',
    "  chromium*|google-chrome*)",
    '    nohup "$BROWSER" \\',
    "      --no-sandbox \\",
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
      return `start_recording(${action.label ?? "default"})`;
    case "stop_recording":
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
      return { type: "start_recording", label: input.label };
    case "stop_recording":
      return { type: "stop_recording", recordingId: input.recordingId };
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
    value.push({
      type: "image-data",
      data: details.screenshot.data,
      mediaType: details.screenshot.mimeType,
    });
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
      const status = await computerUse.getStatus();
      return { status };
    }
    case "status": {
      const status = await computerUse.getStatus();
      return { status };
    }
    case "display": {
      const display = activeDisplayInfo(await computerUse.display.getInfo());
      return { display };
    }
    case "windows": {
      return { windows: await computerUse.display.getWindows() };
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
        windows: await computerUse.display.getWindows().catch(() => undefined),
        command: {
          cwd: result.cwd,
          exitCode: result.exitCode ?? null,
          stdout: result.stdout ?? result.output ?? "",
          stderr: result.stderr ?? "",
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
        await computerUse.recording.start(action.label) as DaytonaRecording,
        computerOptions,
      );
      return { recording, recordings: [recording] };
    }
    case "stop_recording": {
      const recording = compactRecording(
        await computerUse.recording.stop(action.recordingId) as DaytonaRecording,
        computerOptions,
      );
      return { recording, recordings: [recording] };
    }
    case "get_recording": {
      const recording = compactRecording(
        await computerUse.recording.get(action.recordingId) as DaytonaRecording,
        computerOptions,
      );
      return { recording, recordings: [recording] };
    }
    case "list_recordings": {
      const result = await computerUse.recording.list();
      const recordings = isRecord(result) && Array.isArray(result.recordings)
        ? result.recordings.map((recording) => compactRecording(recording as DaytonaRecording, computerOptions))
        : [];
      return { recordings };
    }
  }
}

async function executeDaytonaComputer(
  input: ComputerInput,
  sandboxOptions: SandboxSessionOptions,
  computerOptions: DaytonaComputerToolOptions,
) {
  "use step";

  const context = await getSandboxContext(sandboxOptions);
  const { computerUse } = context.sandbox;
  const summaries = input.actions.map(summarizeAction);
  const details: ComputerOutputDetails = {
    action: input.actions.length === 1 ? input.actions[0]?.type : undefined,
    actions: summaries,
  };
  const recordings: Array<ReturnType<typeof compactRecording>> = [];

  if (input.actions.some(requiresDesktop)) {
    await ensureComputerReady(computerUse);
  }

  for (const action of input.actions) {
    const partial = await runOneAction(action, context, computerOptions);

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
  }

  if (recordings.length > 0) {
    details.recordings = recordings;
  }

  const requestedScreenshot = input.actions.find(
    (action): action is Extract<ComputerAction, { type: "screenshot" }> => action.type === "screenshot",
  );
  if (shouldCaptureAfter(input.actions)) {
    const captured = await captureScreenshot(computerUse, requestedScreenshot);
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
      ? `Found ${details.recordings.length} demo recording${details.recordings.length === 1 ? "" : "s"}`
      : undefined,
    statusValue(details.status) ? `Status: ${statusValue(details.status)}` : undefined,
  ].filter(Boolean);

  return computerContentOutput(contentLines.join("\n"), details);
}

export function createDaytonaComputerTool(
  sandboxOptions: SandboxSessionOptions,
  computerOptions: DaytonaComputerToolOptions = {},
) {
  return tool({
    title: "computer",
    description:
      "Inspect and operate the Daytona sandbox desktop. Execute one or more GUI/browser actions, then receive a fresh screenshot as image content when screen state is relevant.",
    inputSchema: computerInputSchema,
    execute: (input) => executeDaytonaComputer(input, sandboxOptions, computerOptions),
  });
}
