export const GITHUB_APP_DISPLAY_NAME = "Autopr";

export function decodeGithubAppPrivateKey(value: string) {
  const normalized = value.trim().replace(/\\n/g, "\n");
  return normalized.includes("-----BEGIN")
    ? normalized
    : Buffer.from(normalized, "base64").toString("utf8").replace(/\\n/g, "\n").trim();
}

export function buildGithubAppInstallUrl(slug: string) {
  if (!/^[a-z0-9-]+$/i.test(slug)) {
    throw new Error("Invalid GitHub App slug.");
  }
  return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`;
}

export function getTrustedGithubInstallationUrl(value: string | undefined) {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
