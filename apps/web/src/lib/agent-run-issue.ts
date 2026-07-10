export type AgentRunIssue = {
  runId: string;
  stepName?: string;
  attempt?: number;
  retryCount?: number;
  message: string;
  errorStack?: string;
  occurredAt: number;
};

function readRecordProperty(error: unknown, key: string): unknown {
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)[key]
    : undefined;
}

function readStringProperty(error: unknown, key: string): string | undefined {
  const value = readRecordProperty(error, key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumberProperty(error: unknown, key: string): number | undefined {
  const value = readRecordProperty(error, key);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNestedErrorMessage(value: unknown): string | undefined {
  const error = readRecordProperty(value, "error");
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message.length > 0 ? message : undefined;
}

function parseEmbeddedErrorMessage(message: string): string | undefined {
  const jsonStart = message.indexOf("{");
  const jsonEnd = message.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    return undefined;
  }

  try {
    return readNestedErrorMessage(JSON.parse(message.slice(jsonStart, jsonEnd + 1)));
  } catch {
    return undefined;
  }
}

export function displayAgentError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const directNestedMessage = readNestedErrorMessage(error);
  const embeddedMessage = parseEmbeddedErrorMessage(message);
  const causeMessage = parseEmbeddedErrorMessage(String(readRecordProperty(error, "cause") ?? ""));

  return directNestedMessage ?? embeddedMessage ?? causeMessage ?? message;
}

export function agentRunIssueFromError(
  error: unknown,
  runId: string,
  attempt: number,
): AgentRunIssue {
  return {
    runId,
    stepName: readStringProperty(error, "stepName"),
    attempt: readNumberProperty(error, "attempt") ?? attempt,
    retryCount: readNumberProperty(error, "retryCount") ?? Math.max(0, attempt - 1),
    message: displayAgentError(error),
    errorStack: error instanceof Error ? error.stack : undefined,
    occurredAt: Date.now(),
  };
}
