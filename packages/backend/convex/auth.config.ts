import type { AuthConfig } from "convex/server";

const workosClientId = process.env.WORKOS_CLIENT_ID;

if (!workosClientId) {
  throw new Error("Set WORKOS_CLIENT_ID in Convex to your WorkOS AuthKit client ID.");
}

const workosAuthIssuer =
  process.env.WORKOS_AUTH_ISSUER ?? `https://api.workos.com/user_management/${workosClientId}`;
const workosJwks = `https://api.workos.com/sso/jwks/${workosClientId}`;

export default {
  providers: [
    {
      type: "customJwt",
      issuer: "https://api.workos.com/",
      algorithm: "RS256",
      jwks: workosJwks,
      applicationID: workosClientId,
    },
    {
      type: "customJwt",
      issuer: workosAuthIssuer,
      algorithm: "RS256",
      jwks: workosJwks,
      applicationID: workosClientId,
    },
  ],
} satisfies AuthConfig;
