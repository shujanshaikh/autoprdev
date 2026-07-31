export function getWorkOSAccessTokenVerificationOptions(clientId: string) {
  return {
    issuer: [
      "https://api.workos.com",
      "https://api.workos.com/",
      `https://api.workos.com/user_management/${clientId}`,
    ],
  };
}
