import { hasObjectType, hasStringType } from "@autopr/config/runtime-type";
import { type JsonObject } from "@autopr/config/runtime-value";

function record<ValueValue>(value: ValueValue): JsonObject | undefined {
  return value !== null && hasObjectType(value) ? /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ value as JsonObject : undefined;
}

/**
 * Daytona exposes stdout under different aliases for direct and session
 * commands. Select one authoritative stdout value instead of concatenating
 * aliases, which would corrupt machine-readable Git values such as branch
 * names and commit SHAs (`main\nmain`, for example).
 */
export function sandboxCommandStdout<ValueValue>(value: ValueValue) {
  const result = record(value);
  const artifacts = record(result?.artifacts);
  return [result?.stdout, result?.result, artifacts?.stdout, result?.output]
    .find((part): part is string => hasStringType(part) && part.length > 0);
}

export function sandboxCommandOutput<ValueValue>(value: ValueValue) {
  const result = record(value);
  const stdout = sandboxCommandStdout(value);
  const stderr = hasStringType(result?.stderr) && result.stderr.length > 0
    ? result.stderr
    : undefined;

  if (!stdout) return stderr ?? "";
  if (!stderr || stdout.trim() === stderr.trim()) return stdout;
  return `${stdout}\n${stderr}`;
}

export function sandboxCommandText<ValueValue>(value: ValueValue) {
  return sandboxCommandOutput(value).trim();
}
