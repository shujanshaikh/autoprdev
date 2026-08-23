import { createHash } from "node:crypto";

import sharp from "sharp";

import { CuaComputerClient } from "./cua-client";

export type ScreenshotRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScreenshotRequest = {
  format?: "jpeg" | "png";
  quality?: number;
  region?: ScreenshotRegion;
  windowId?: string | number;
};

export type CuaObservation = {
  id: string;
  data: string;
  mimeType: string;
  sizeBytes: number;
  cursorPosition?: { x: number; y: number };
  width: number;
  height: number;
  format: "jpeg" | "png";
  quality: number;
  origin: { x: number; y: number };
  sourceWidth: number;
  sourceHeight: number;
  screenWidth: number;
  screenHeight: number;
  scaleX: number;
  scaleY: number;
  hash: string;
  capturedAt: string;
  captureDurationMs: number;
  captureKind: "desktop_state" | "legacy_screenshot";
};

type RawCapture = {
  data: string;
  mimeType: string;
  sourceWidth?: number;
  sourceHeight?: number;
  screenWidth: number;
  screenHeight: number;
  cursorPosition?: { x: number; y: number };
  captureKind: CuaObservation["captureKind"];
};

type ProcessedCapture = Omit<
  CuaObservation,
  "id" | "capturedAt" | "captureDurationMs"
>;

const DEFAULT_FORMAT = "png";
const DEFAULT_QUALITY = 85;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(value: Record<string, unknown> | undefined, key: string): number | undefined {
  const field = value?.[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function parseImageData(raw: string | undefined, fallbackMimeType: string) {
  if (!raw) throw new Error("CUA did not return screenshot data.");
  const match = raw.match(/^data:(?<mediaType>[^;]+);base64,(?<data>.+)$/s);
  return {
    data: match?.groups?.data ?? raw,
    mimeType: match?.groups?.mediaType ?? fallbackMimeType,
  };
}

function parsePoint(value: unknown): { x: number; y: number } | undefined {
  if (!isRecord(value)) return undefined;
  const x = numberField(value, "x");
  const y = numberField(value, "y");
  return x === undefined || y === undefined ? undefined : { x, y };
}

async function rawCapture(cua: CuaComputerClient): Promise<RawCapture> {
  if (cua.supports("get_desktop_state")) {
    const desktop = await cua.command("get_desktop_state");
    const { data, mimeType } = parseImageData(
      typeof desktop.image_data === "string" ? desktop.image_data : undefined,
      "image/png",
    );
    const screenWidth = numberField(desktop, "screen_width");
    const screenHeight = numberField(desktop, "screen_height");
    const sourceWidth = numberField(desktop, "screenshot_width");
    const sourceHeight = numberField(desktop, "screenshot_height");
    if (!screenWidth || !screenHeight) {
      throw new Error("CUA desktop state did not include valid screen dimensions.");
    }
    return {
      data,
      mimeType,
      sourceWidth,
      sourceHeight,
      screenWidth,
      screenHeight,
      captureKind: "desktop_state",
    };
  }

  const [shot, size, cursor] = await Promise.all([
    cua.command("screenshot", { format: "png", quality: 95 }),
    cua.command("get_screen_size"),
    cua.command("get_cursor_position").catch(() => undefined),
  ]);
  const dimensions = isRecord(size.size) ? size.size : undefined;
  const screenWidth = numberField(dimensions, "width");
  const screenHeight = numberField(dimensions, "height");
  if (!screenWidth || !screenHeight) throw new Error("CUA returned an invalid desktop size.");
  const { data, mimeType } = parseImageData(
    typeof shot.image_data === "string" ? shot.image_data : undefined,
    "image/png",
  );
  return {
    data,
    mimeType,
    screenWidth,
    screenHeight,
    cursorPosition: parsePoint(cursor?.position),
    captureKind: "legacy_screenshot",
  };
}

async function imageDimensions(buffer: Buffer, raw: RawCapture): Promise<{ width: number; height: number }> {
  if (raw.sourceWidth && raw.sourceHeight) {
    return { width: raw.sourceWidth, height: raw.sourceHeight };
  }
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) throw new Error("CUA screenshot dimensions are unavailable.");
  return { width: metadata.width, height: metadata.height };
}

async function windowRegion(
  cua: CuaComputerClient,
  windowId: string | number,
  source: { width: number; height: number },
  screen: { width: number; height: number },
): Promise<ScreenshotRegion> {
  const [position, size] = await Promise.all([
    cua.command("get_window_position", { window_id: windowId }),
    cua.command("get_window_size", { window_id: windowId }),
  ]);
  const x = numberField(position, "x");
  const y = numberField(position, "y");
  const width = numberField(size, "width");
  const height = numberField(size, "height");
  if (x === undefined || y === undefined || !width || !height) {
    throw new Error(`CUA could not read bounds for window ${windowId}.`);
  }
  const scaleX = source.width / screen.width;
  const scaleY = source.height / screen.height;
  return {
    x: Math.max(0, Math.floor(x * scaleX)),
    y: Math.max(0, Math.floor(y * scaleY)),
    width: Math.max(1, Math.ceil(width * scaleX)),
    height: Math.max(1, Math.ceil(height * scaleY)),
  };
}

function boundedRegion(region: ScreenshotRegion, source: { width: number; height: number }): ScreenshotRegion {
  if (
    region.x < 0
    || region.y < 0
    || region.width < 1
    || region.height < 1
    || region.x >= source.width
    || region.y >= source.height
  ) {
    throw new Error(`Screenshot region is outside the ${source.width}x${source.height} CUA desktop image.`);
  }
  return {
    x: region.x,
    y: region.y,
    width: Math.min(region.width, source.width - region.x),
    height: Math.min(region.height, source.height - region.y),
  };
}

async function processCapture(
  cua: CuaComputerClient,
  raw: RawCapture,
  request: ScreenshotRequest,
): Promise<ProcessedCapture> {
  const sourceBuffer = Buffer.from(raw.data, "base64");
  const source = await imageDimensions(sourceBuffer, raw);
  const requestedRegion = request.windowId !== undefined
    ? await windowRegion(
        cua,
        request.windowId,
        source,
        { width: raw.screenWidth, height: raw.screenHeight },
      )
    : request.region;
  const region = requestedRegion
    ? boundedRegion(requestedRegion, source)
    : { x: 0, y: 0, width: source.width, height: source.height };
  const format = request.format ?? DEFAULT_FORMAT;
  const quality = request.quality ?? DEFAULT_QUALITY;
  const needsTransform = requestedRegion !== undefined || format !== raw.mimeType.split("/").at(-1);
  let output = sourceBuffer;
  if (needsTransform) {
    let pipeline = sharp(sourceBuffer).extract({
      left: region.x,
      top: region.y,
      width: region.width,
      height: region.height,
    });
    pipeline = format === "jpeg" ? pipeline.jpeg({ quality }) : pipeline.png();
    output = await pipeline.toBuffer();
  }

  const scaleX = raw.screenWidth / source.width;
  const scaleY = raw.screenHeight / source.height;
  const cursorInSource = raw.cursorPosition
    ? {
        x: raw.cursorPosition.x / scaleX - region.x,
        y: raw.cursorPosition.y / scaleY - region.y,
      }
    : undefined;
  const cursorPosition = cursorInSource
    && cursorInSource.x >= 0
    && cursorInSource.y >= 0
    && cursorInSource.x < region.width
    && cursorInSource.y < region.height
    ? { x: Math.round(cursorInSource.x), y: Math.round(cursorInSource.y) }
    : undefined;
  const hash = createHash("sha256").update(output).digest("hex");
  return {
    data: output.toString("base64"),
    mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
    sizeBytes: output.byteLength,
    cursorPosition,
    width: region.width,
    height: region.height,
    format,
    quality,
    origin: { x: region.x, y: region.y },
    sourceWidth: source.width,
    sourceHeight: source.height,
    screenWidth: raw.screenWidth,
    screenHeight: raw.screenHeight,
    scaleX,
    scaleY,
    hash,
    captureKind: raw.captureKind,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function captureCuaObservation(
  cua: CuaComputerClient,
  request: ScreenshotRequest,
  options: {
    sequence: number;
    initialDelayMs?: number;
  },
): Promise<CuaObservation> {
  if (options.initialDelayMs) await sleep(options.initialDelayMs);
  const startedAt = Date.now();
  const capture = await processCapture(cua, await rawCapture(cua), request);

  return {
    ...capture,
    id: `obs-${options.sequence}-${capture.hash.slice(0, 12)}`,
    capturedAt: new Date().toISOString(),
    captureDurationMs: Date.now() - startedAt,
  };
}

export function observationPointToScreen(
  observation: CuaObservation,
  point: { x: number; y: number },
): { x: number; y: number } {
  if (point.x < 0 || point.y < 0 || point.x >= observation.width || point.y >= observation.height) {
    throw new Error(
      `Coordinate (${point.x}, ${point.y}) is outside observation ${observation.id} `
      + `at ${observation.width}x${observation.height}.`,
    );
  }
  return {
    x: Math.round((observation.origin.x + point.x) * observation.scaleX),
    y: Math.round((observation.origin.y + point.y) * observation.scaleY),
  };
}

export function screenshotForModel(observation: CuaObservation) {
  return observation;
}
