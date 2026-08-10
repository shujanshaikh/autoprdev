type TriggerRunError = {
  message?: string;
  stackTrace?: string;
};

function stackSummary(stackTrace: string | undefined): string | undefined {
  return stackTrace
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("at "));
}

/** Prefer the task's root exception over Trigger.dev's generic wrapper text. */
export function triggerRunFailureMessage(error: TriggerRunError | undefined): string {
  const message = error?.message?.trim();
  const generic =
    !message ||
    /trigger\.dev internal error/i.test(message) ||
    /TASK_RUN_[A-Z_]+/.test(message);

  if (generic) {
    const summary = stackSummary(error?.stackTrace);
    if (summary) return summary;
  }

  return message || "Trigger.dev reported that the agent run failed.";
}
