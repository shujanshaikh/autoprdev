import { readFileSync } from "node:fs";
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

function triggerWriterPath(runtimeRequire: NodeJS.Require) {
  const coreEntry = runtimeRequire.resolve("@trigger.dev/core/v3");
  return path.join(
    path.dirname(coreEntry),
    "realtimeStreams",
    "streamsWriterV2.js",
  );
}

describe("Trigger runtime dependencies", () => {
  it("can resolve sandbox providers and Daytona's runtime-loaded multipart dependencies from a task bundle", () => {
    const runtimeRequire = createTriggerRuntimeRequire();

    expect(runtimeRequire.resolve("@daytona/sdk")).toContain("@daytona/sdk");
    expect(runtimeRequire.resolve("e2b")).toContain("e2b");
    expect(runtimeRequire.resolve("busboy")).toContain("busboy");
    expect(runtimeRequire.resolve("form-data")).toContain("form-data");
  });

  it("uses the fetch transport for Trigger realtime writers", () => {
    const runtimeRequire = createTriggerRuntimeRequire();

    expect(readFileSync(triggerWriterPath(runtimeRequire), "utf8")).toContain(
      'forceTransport: "fetch"',
    );
  });

  it("runs the pinned workspace Trigger CLI instead of an unpatched dlx copy", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts?: Record<string, string>; devDependencies?: Record<string, string> };

    expect(packageJson.devDependencies?.["trigger.dev"]).toBe("4.5.11");
    expect(packageJson.scripts?.["trigger:dev"]).toBe(
      "trigger dev --config trigger.config.ts",
    );

    const runtimeRequire = createTriggerRuntimeRequire();
    const cliRequire = createRequire(runtimeRequire.resolve("trigger.dev/package.json"));
    expect(readFileSync(triggerWriterPath(cliRequire), "utf8")).toContain(
      'forceTransport: "fetch"',
    );
  });

  it("pins task execution away from the Node 24 native crypto crash", () => {
    const config = readFileSync(
      path.join(process.cwd(), "trigger.config.ts"),
      "utf8",
    );

    expect(config).toContain('runtime: "node-22"');
  });
});
