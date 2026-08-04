import { describe, expect, it } from "vitest";

import {
  autoprSandboxLabels,
  autoprSandboxName,
  isExpectedAutoprSandbox,
} from "@autopr/backend/convex/lib/sandboxIdentity";

describe("AutoPR sandbox identity", () => {
  const projectId = "c113125b-938c-409a-9d32-03b410f44330";

  it("accepts only the expected name and project label", () => {
    expect(isExpectedAutoprSandbox({
      name: autoprSandboxName(projectId),
      labels: autoprSandboxLabels(projectId),
    }, projectId)).toBe(true);
  });

  it("rejects a sandbox whose name or project label does not match", () => {
    expect(isExpectedAutoprSandbox({
      name: autoprSandboxName("another-project"),
      labels: autoprSandboxLabels(projectId),
    }, projectId)).toBe(false);
    expect(isExpectedAutoprSandbox({
      name: autoprSandboxName(projectId),
      labels: autoprSandboxLabels("another-project"),
    }, projectId)).toBe(false);
    expect(isExpectedAutoprSandbox({}, projectId)).toBe(false);
  });
});
