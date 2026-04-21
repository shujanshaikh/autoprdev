import type { AuthConfig } from "convex/server";

const clerkIssuerDomain = process.env.CLERK_FRONTEND_API_URL ?? process.env.CLERK_JWT_ISSUER_DOMAIN;

export default {
  providers: [
    {
      domain: clerkIssuerDomain!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
