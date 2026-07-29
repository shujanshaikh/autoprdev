import { describe, expect, it } from "vitest";

import { parseProjectSandboxBranchResponse } from "./project-sandbox-branch-query";

describe("project sandbox branch responses", () => {
  it("accepts an authoritative Daytona checkout", () => {
    expect(parseProjectSandboxBranchResponse({
      available: true,
      branch: "feature/actual-checkout",
      detachedHead: false,
      commitSha: "abc1234",
      hasChanges: true,
      checkedAt: 123,
    })).toEqual({
      available: true,
      branch: "feature/actual-checkout",
      detachedHead: false,
      commitSha: "abc1234",
      hasChanges: true,
      checkedAt: 123,
    });
  });

  it("represents a stopped sandbox without claiming a branch", () => {
    expect(parseProjectSandboxBranchResponse({
      available: false,
      branch: null,
      detachedHead: false,
      commitSha: "",
      hasChanges: false,
      checkedAt: 456,
    })).toMatchObject({ available: false, branch: null });
  });

  it("rejects stale or malformed responses", () => {
    expect(() => parseProjectSandboxBranchResponse({ branch: "main" }))
      .toThrow("Could not read the sandbox branch.");
    expect(() => parseProjectSandboxBranchResponse({ error: "Daytona unavailable" }))
      .toThrow("Daytona unavailable");
  });
});
