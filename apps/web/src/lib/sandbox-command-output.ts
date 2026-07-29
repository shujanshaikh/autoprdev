function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

/**
 * Daytona command responses expose the same stdout through different fields,
 * depending on whether a command runs directly or in a session. Select one
 * stdout source instead of concatenating aliases, which can corrupt values
 * such as branch names and commit SHAs (for example, `main\nmain`).
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
  if (!stderr || stdout.includes(stderr)) return stdout;
  return `${stdout}\n${stderr}`;
}
