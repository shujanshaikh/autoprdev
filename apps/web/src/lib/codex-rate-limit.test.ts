import { describe, expect, it } from "vitest";

import { mergeRateLimitBucket } from "./codex-rate-limit";

describe("mergeRateLimitBucket", () => {
  it("preserves concurrent increments in the same window", () => {
    expect(mergeRateLimitBucket(
      { count: 4, resetAt: 10_000 },
      { count: 4, resetAt: 10_000 },
    )).toEqual({ count: 5, resetAt: 10_000 });
  });

  it("increments a newer persisted window instead of restoring an old one", () => {
    expect(mergeRateLimitBucket(
      { count: 2, resetAt: 20_000 },
      { count: 7, resetAt: 10_000 },
    )).toEqual({ count: 3, resetAt: 20_000 });
  });

  it("uses the proposed bucket when it starts a newer window", () => {
    expect(mergeRateLimitBucket(
      { count: 7, resetAt: 10_000 },
      { count: 1, resetAt: 20_000 },
    )).toEqual({ count: 1, resetAt: 20_000 });
  });
});
