export const WORKOS_ACCESS_TOKEN_HEADER = "x-autopr-workos-access-token";

export function getWorkOSAccessTokenVerificationOptions(clientId: string) {
  return {
    issuer: [
      "https://api.workos.com",
      "https://api.workos.com/",
      `https://api.workos.com/user_management/${clientId}`,
    ],
  };
}

export function setWorkOSAccessTokenHeader(
  headers: Headers,
  accessToken: string | null | undefined,
) {
  // Set the header even when token retrieval returned null. Its presence tells
  // the server that Authorization belongs to another protocol (for example a
  // Trigger.dev Session), so server-side AuthKit should fall back to its cookie.
  headers.set(WORKOS_ACCESS_TOKEN_HEADER, accessToken?.trim() ?? "");
  return headers;
}

export function resolveWorkOSRequestAccessToken(options: {
  dedicatedHeader: string | null | undefined;
  authorization: string | null | undefined;
}) {
  if (options.dedicatedHeader !== null && options.dedicatedHeader !== undefined) {
    return options.dedicatedHeader.trim() || undefined;
  }

  if (!options.authorization?.startsWith("Bearer ")) {
    return undefined;
  }

  return options.authorization.slice("Bearer ".length).trim() || undefined;
}
