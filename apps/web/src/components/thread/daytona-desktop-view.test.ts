import { describe, expect, it } from "vitest";

import { hasPaintedDesktopFrame } from "./daytona-desktop-view";

function frame(data: number[], width: number, height: number) {
  return { data: new Uint8ClampedArray(data), width, height };
}

describe("hasPaintedDesktopFrame", () => {
  it("rejects an empty or entirely black VNC framebuffer", () => {
    expect(hasPaintedDesktopFrame(frame([], 0, 0))).toBe(false);
    expect(hasPaintedDesktopFrame(frame(new Array(16 * 4).fill(0), 4, 4))).toBe(false);
  });

  it("accepts a framebuffer after visible desktop pixels arrive", () => {
    const pixels = new Array(16 * 4).fill(0);
    for (const pixel of [0, 3, 8, 15]) {
      pixels[pixel * 4] = 80;
      pixels[pixel * 4 + 3] = 255;
    }

    expect(hasPaintedDesktopFrame(frame(pixels, 4, 4))).toBe(true);
  });
});
