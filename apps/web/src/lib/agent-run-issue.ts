import { hasNumberType, hasObjectType, hasStringType } from "@autopr/config/runtime-type";
import { type JsonObject, type JsonValue } from "@autopr/config/runtime-value";

export type AgentRunIssue = {
  runId: string;
  stepName?: string;
  attempt?: number;
  retryCount?: number;
  message: string;
  errorStack?: string;
  occurredAt: number;
};

function readRecordProperty<ErrorValue>(error: ErrorValue, key: string): JsonValue {
  return hasObjectType(error) && error !== null
    ? (/* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ error as JsonObject)[key]
    : undefined;
}

function readStringProperty<ErrorValue>(error: ErrorValue, key: string): string | undefined {
  const value = readRecordProperty(error, key);
  return hasStringType(value) && value.length > 0 ? value : undefined;
}

function readNumberProperty<ErrorValue>(error: ErrorValue, key: string): number | undefined {
  const value = readRecordProperty(error, key);
  return hasNumberType(value) && Number.isFinite(value) ? value : undefined;
}

function readNestedErrorMessage<ValueValue>(value: ValueValue): string | undefined {
  const error = readRecordProperty(value, "error");
  if (!hasObjectType(error) || error === null) {
    return undefined;
  }

  const message = (/* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ error as JsonObject).message;
  return hasStringType(message) && message.length > 0 ? message : undefined;
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

export function displayAgentError<ErrorValue>(error: ErrorValue): string {
  const message = error instanceof Error ? error.message : String(error);
  const directNestedMessage = readNestedErrorMessage(error);
  const embeddedMessage = parseEmbeddedErrorMessage(message);
  const causeMessage = parseEmbeddedErrorMessage(String(readRecordProperty(error, "cause") ?? ""));

  return directNestedMessage ?? embeddedMessage ?? causeMessage ?? message;
}

export function agentRunIssueFromError<ErrorValue>(
  error: ErrorValue,
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
