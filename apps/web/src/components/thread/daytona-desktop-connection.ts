export const DESKTOP_PREVIEW_HEARTBEAT_MS = 5 * 60 * 1_000;

export function hasPaintedDesktopFrame(frame: Pick<ImageData, "data" | "height" | "width">) {
  if (frame.width <= 0 || frame.height <= 0 || frame.data.length < 4) return false;

  const sampleStride = Math.max(4, Math.floor(frame.data.length / (4 * 4_096)) * 4);
  let visibleSamples = 0;

  for (let index = 0; index < frame.data.length; index += sampleStride) {
    if (Math.max(frame.data[index] ?? 0, frame.data[index + 1] ?? 0, frame.data[index + 2] ?? 0) > 24) {
      visibleSamples += 1;
      if (visibleSamples >= 4) return true;
    }
  }

  return false;
}
