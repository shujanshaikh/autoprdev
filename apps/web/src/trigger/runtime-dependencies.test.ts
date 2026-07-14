import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

function createTriggerRuntimeRequire() {
  const bundledTaskUrl = pathToFileURL(
    path.join(process.cwd(), ".trigger", "tmp", "build-regression", "task.mjs"),
  );

  return createRequire(bundledTaskUrl);
}

describe("Trigger runtime dependencies", () => {
  it("can resolve Daytona and its runtime-loaded multipart dependencies from a task bundle", () => {
    const runtimeRequire = createTriggerRuntimeRequire();

    expect(runtimeRequire.resolve("@daytona/sdk")).toContain("@daytona/sdk");
    expect(runtimeRequire.resolve("busboy")).toContain("busboy");
    expect(runtimeRequire.resolve("form-data")).toContain("form-data");
  });
});
