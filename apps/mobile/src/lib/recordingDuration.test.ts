import { describe, expect, it } from "vitest";

import { formatRecordingDuration } from "./recordingDuration";

describe("formatRecordingDuration", () => {
  it("carries rounded seconds into the next minute", () => {
    expect(formatRecordingDuration(119.6)).toBe("2:00");
  });

  it("preserves sub-minute and missing duration behavior", () => {
    expect(formatRecordingDuration(12.4)).toBe("12s");
    expect(formatRecordingDuration(0)).toBe("1s");
    expect(formatRecordingDuration(undefined)).toBeNull();
  });
});
