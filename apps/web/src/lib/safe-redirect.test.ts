import { describe, expect, it } from "vitest";

import { getSafeRedirectUrl } from "./safe-redirect";

describe("getSafeRedirectUrl", () => {
  it.each([
    "javascript:alert(document.domain)",
    "https://evil.example/phish",
    "//evil.example/phish",
    "  //evil.example/phish",
    "/\\evil.example/phish",
    "data:text/html,owned",
  ])("rejects unsafe return targets: %s", (returnTo) => {
    expect(getSafeRedirectUrl(returnTo)).toBe("/dashboard");
  });

  it("allows an origin-relative path", () => {
    expect(getSafeRedirectUrl("/project/123?tab=changes#latest")).toBe(
      "/project/123?tab=changes#latest",
    );
  });
});
