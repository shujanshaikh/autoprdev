import "@tanstack/react-start/server-only";

import { auth } from "@clerk/tanstack-react-start/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";

const missingConvexAuthMessage =
  "Convex auth is not configured for Clerk. In Clerk, enable the Convex integration or create a JWT template named 'convex'.";

export class ConvexAuthConfigurationError extends Error {
  constructor(message = missingConvexAuthMessage) {
    super(message);
    this.name = "ConvexAuthConfigurationError";
  }
}

export class ConvexUnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "ConvexUnauthorizedError";
  }
}

function getConvexUrl() {
  const url = process.env.VITE_CONVEX_URL;
  if (!url) {
    throw new ConvexAuthConfigurationError("Missing VITE_CONVEX_URL in your web environment");
  }
  return url;
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

async function getConvexAuthToken() {
  const authState = await auth();

  if (!authState.userId) {
    throw new ConvexUnauthorizedError();
  }

  try {
    return await authState.getToken({ template: "convex" });
  } catch (error) {
    if (isMissingConvexJwtTemplateError(error)) {
      throw new ConvexAuthConfigurationError();
    }

    throw error;
  }
}

export async function convexQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query>,
): Promise<FunctionReturnType<Query>> {
  const token = await getConvexAuthToken();

  if (!token) {
    throw new ConvexUnauthorizedError();
  }

  return fetchQuery(query, args, { token, url: getConvexUrl() });
}

export async function convexMutation<Mutation extends FunctionReference<"mutation">>(
  mutation: Mutation,
  args: FunctionArgs<Mutation>,
): Promise<FunctionReturnType<Mutation>> {
  const token = await getConvexAuthToken();

  if (!token) {
    throw new ConvexUnauthorizedError();
  }

  return fetchMutation(mutation, args, { token, url: getConvexUrl() });
}
