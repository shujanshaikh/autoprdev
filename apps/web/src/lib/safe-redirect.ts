const DEFAULT_SAFE_REDIRECT_URL = "/dashboard";

export function getSafeRedirectUrl(value: string | null | undefined, fallback = DEFAULT_SAFE_REDIRECT_URL) {
  const candidate = value?.trim();

  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }

  return candidate;
}

export function getSafeAbsoluteRedirectUrl(
  value: string | null | undefined,
  requestUrl: string,
  fallback = DEFAULT_SAFE_REDIRECT_URL,
) {
  const requestOrigin = new URL(requestUrl).origin;
  const fallbackUrl = new URL(getSafeRedirectUrl(fallback), requestOrigin).toString();
  const candidate = value?.trim();

  if (!candidate) {
    return fallbackUrl;
  }

  if (candidate.startsWith("/") && !candidate.startsWith("//")) {
    return new URL(candidate, requestOrigin).toString();
  }

  try {
    const candidateUrl = new URL(candidate);

    if (candidateUrl.origin !== requestOrigin || candidateUrl.username || candidateUrl.password) {
      return fallbackUrl;
    }

    return candidateUrl.toString();
  } catch {
    return fallbackUrl;
  }
}
