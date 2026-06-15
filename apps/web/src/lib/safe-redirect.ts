const DEFAULT_SAFE_REDIRECT_URL = "/dashboard";

export function getSafeRedirectUrl(value: string | null | undefined, fallback = DEFAULT_SAFE_REDIRECT_URL) {
  const candidate = value?.trim();

  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }

  return candidate;
}
