import { describe, expect, it } from "vitest";

import { sandboxDefaultWorkDir, sandboxUserHome } from "./repo-path";

describe("sandbox provider paths", () => {
  it("uses the AutoPR home for E2B sandboxes", () => {
    expect(sandboxUserHome("e2b")).toBe("/home/autopr");
    expect(sandboxDefaultWorkDir("e2b")).toBe("/home/autopr");
  });

  it("keeps Daytona's existing home and workspace root", () => {
    expect(sandboxUserHome("daytona")).toBe("/home/daytona");
    expect(sandboxDefaultWorkDir("daytona")).toBe("/home");
  });
});
