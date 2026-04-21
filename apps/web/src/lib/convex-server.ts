import { env } from "@autopr/env/web";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";

const missingConvexAuthMessage =
  "Convex auth is not configured in Clerk. Enable Clerk's Convex integration or create a Clerk JWT template named 'convex'.";

export class ConvexAuthConfigurationError extends Error {
  constructor(message = missingConvexAuthMessage) {
    super(message);
    this.name = "ConvexAuthConfigurationError";
  }
}

function hasConvexAudience(sessionClaims: unknown) {
  if (!sessionClaims || typeof sessionClaims !== "object") {
    return false;
  }

  const audience = (sessionClaims as { aud?: unknown }).aud;

  return audience === "convex" || (Array.isArray(audience) && audience.includes("convex"));
}

function isMissingConvexJwtTemplateError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const clerkError = error as {
    status?: unknown;
    errors?: Array<{ code?: unknown; message?: unknown; longMessage?: unknown }>;
  };

  return (
    clerkError.status === 404 &&
    Array.isArray(clerkError.errors) &&
    clerkError.errors.some(
      (entry) =>
        entry.code === "resource_not_found" &&
        (entry.message === "JWT template not found" ||
          entry.longMessage === "No JWT template exists with name: convex"),
    )
  );
}

export async function getAuthenticatedConvexClient() {
  const authState = await auth();

  if (!authState.userId) {
    return null;
  }

  let token: string | null;

  try {
    token = hasConvexAudience(authState.sessionClaims)
      ? await authState.getToken()
      : await authState.getToken({ template: "convex" });
  } catch (error) {
    if (isMissingConvexJwtTemplateError(error)) {
      throw new ConvexAuthConfigurationError();
    }

    throw error;
  }

  if (!token) {
    return null;
  }

  const client = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
  client.setAuth(token);

  return {
    client,
    userId: authState.userId,
  };
}
