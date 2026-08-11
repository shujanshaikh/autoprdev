export function environmentSecretValues(environment: Record<string, string> | undefined): string[] {
  return [...new Set(Object.values(environment ?? {}).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
}

export function redactSensitiveValues(value: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (redacted, secret) => redacted.replaceAll(secret, "[REDACTED]"),
    value,
  );
}
