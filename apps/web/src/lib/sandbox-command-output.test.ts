import { describe, expect, it } from "vitest";

import { sandboxCommandOutput, sandboxCommandStdout, sandboxCommandText } from "@autopr/backend/convex/lib/sandboxCommandOutput";

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

  it("resolves the same branch from Convex session and web direct-command responses", () => {
    const convexSessionResponse = {
      stdout: "main\n",
      output: "main\n",
      stderr: "",
    };
    const webDirectResponse = {
      result: "main\n",
      artifacts: { stdout: "main\n" },
    };

    expect(sandboxCommandText(convexSessionResponse)).toBe("main");
    expect(sandboxCommandText(webDirectResponse)).toBe("main");
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

  it("preserves distinct stderr even when it is a substring of stdout", () => {
    expect(sandboxCommandOutput({ stdout: "fatal: invalid ref", stderr: "invalid ref" })).toBe(
      "fatal: invalid ref\ninvalid ref",
    );
  });
});
