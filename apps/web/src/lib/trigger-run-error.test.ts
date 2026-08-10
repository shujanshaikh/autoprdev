import { describe, expect, it } from "vitest";

import { triggerRunFailureMessage } from "./trigger-run-error";

describe("Trigger run error display", () => {
  it("uses the root stack exception instead of Trigger's generic wrapper", () => {
    expect(triggerRunFailureMessage({
      message: "trigger.dev internal error (TASK_RUN_UNCAUGHT_EXCEPTION)",
      stackTrace:
        "TimeoutError: The operation was aborted due to timeout\n" +
        "    at new DOMException (node:internal/per_context/domexception:76:18)",
    })).toBe("TimeoutError: The operation was aborted due to timeout");
  });

  it("preserves a specific task error", () => {
    expect(triggerRunFailureMessage({
      message: "The repository could not be cloned.",
      stackTrace: "Error: lower-level failure",
    })).toBe("The repository could not be cloned.");
  });

  it("has a stable fallback when Trigger returns no error details", () => {
    expect(triggerRunFailureMessage(undefined)).toBe(
      "Trigger.dev reported that the agent run failed.",
    );
  });
});
