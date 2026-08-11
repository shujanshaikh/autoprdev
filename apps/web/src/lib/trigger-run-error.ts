type TriggerRunError = {
  message?: string;
  stackTrace?: string;
};

const EXCEPTION_HEADER = /^[\w$.]*(?:Error|Exception)\b.*/;

function stackSummary(stackTrace: string | undefined): string | undefined {
  return stackTrace
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => EXCEPTION_HEADER.test(line));
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
    return "Trigger.dev reported that the agent run failed.";
  }

  return message;
}
