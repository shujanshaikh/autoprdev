import { describe, expect, it } from "vitest";

import { sandboxCommandOutput, sandboxCommandStdout } from "./sandbox-command-output";

describe("sandbox command output", () => {
  it("does not duplicate stdout aliases from Daytona session commands", () => {
    const response = {
      stdout: "main\n",
      output: "main\n",
      stderr: "",
    };

    expect(sandboxCommandStdout(response)).toBe("main\n");
    expect(sandboxCommandOutput(response)).toBe("main\n");
  });

  it("uses direct-command result output and includes distinct diagnostics", () => {
    expect(sandboxCommandOutput({ result: "commit output", stderr: "hook warning" })).toBe(
      "commit output\nhook warning",
    );
  });

  it("does not append stderr when the combined output already contains it", () => {
    expect(sandboxCommandOutput({ output: "fatal: invalid ref", stderr: "fatal: invalid ref" })).toBe(
      "fatal: invalid ref",
    );
  });
});
