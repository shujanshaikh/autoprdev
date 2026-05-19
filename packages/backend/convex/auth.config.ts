import type { AuthConfig } from "convex/server";

const workosClientId = process.env.WORKOS_CLIENT_ID;

if (!workosClientId) {
  throw new Error("Set WORKOS_CLIENT_ID in Convex to your WorkOS AuthKit client ID.");
}

export default {
  providers: [
    {
      type: "customJwt",
      issuer: "https://api.workos.com/",
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${workosClientId}`,
      applicationID: workosClientId,
    },
    {
      type: "customJwt",
      issuer: `https://api.workos.com/user_management/${workosClientId}`,
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${workosClientId}`,
    },
  ],
} satisfies AuthConfig;
