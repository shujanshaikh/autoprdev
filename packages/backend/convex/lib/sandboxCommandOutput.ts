function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

/**
 * Daytona exposes stdout under different aliases for direct and session
 * commands. Select one authoritative stdout value instead of concatenating
 * aliases, which would corrupt machine-readable Git values such as branch
 * names and commit SHAs (`main\nmain`, for example).
 */
export function sandboxCommandStdout(value: unknown) {
  const result = record(value);
  const artifacts = record(result?.artifacts);
  return [result?.stdout, result?.result, artifacts?.stdout, result?.output]
    .find((part): part is string => typeof part === "string" && part.length > 0);
}

export function sandboxCommandOutput(value: unknown) {
  const result = record(value);
  const stdout = sandboxCommandStdout(value);
  const stderr = typeof result?.stderr === "string" && result.stderr.length > 0
    ? result.stderr
    : undefined;

  if (!stdout) return stderr ?? "";
  if (!stderr || stdout.trim() === stderr.trim()) return stdout;
  return `${stdout}\n${stderr}`;
}

export function sandboxCommandText(value: unknown) {
  return sandboxCommandOutput(value).trim();
}
