const SECRET_ASSIGNMENT = /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTH|CREDENTIAL)[A-Z0-9_]*)\s*[=:]\s*([^\s]+)/gi;
const URL_CREDENTIALS = /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const AUTHORIZATION_VALUE = /\b(authorization\s*[:=]\s*)(?:bearer\s+|token\s+)?[^\s]+/gi;
const HIGH_ENTROPY_CREDENTIAL = /\b(?:gh[opsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g;

export function redactGitDiagnostic(value: string, sensitiveValues: readonly string[] = []) {
  let redacted = value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(URL_CREDENTIALS, "$1[REDACTED]@")
    .replace(AUTHORIZATION_VALUE, "$1[REDACTED]")
    .replace(SECRET_ASSIGNMENT, "$1=[REDACTED]")
    .replace(HIGH_ENTROPY_CREDENTIAL, "[REDACTED]");

  for (const secret of sensitiveValues) {
    if (secret.length >= 4) redacted = redacted.split(secret).join("[REDACTED]");
  }

  return redacted.trim().slice(0, 8_000);
}
