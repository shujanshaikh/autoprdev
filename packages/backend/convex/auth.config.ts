import type { AuthConfig } from "convex/server";


const clerkIssuerDomain = process.env.CLERK_FRONTEND_API_URL ?? process.env.CLERK_JWT_ISSUER_DOMAIN;

if (!clerkIssuerDomain) {
  throw new Error("Set CLERK_FRONTEND_API_URL in Convex to your Clerk Frontend API URL.");
}

export default {
  providers: [
    {
      domain: clerkIssuerDomain,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
