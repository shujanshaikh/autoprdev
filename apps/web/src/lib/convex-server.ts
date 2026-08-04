import "@tanstack/react-start/server-only";

import { getAuth } from "@workos/authkit-tanstack-react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";

import {
  resolveWorkOSRequestAccessToken,
  WORKOS_ACCESS_TOKEN_HEADER,
} from "#/lib/workos-access-token";

const missingConvexAuthMessage =
  "Convex auth is not configured for WorkOS AuthKit. Set WORKOS_CLIENT_ID in Convex and make sure the app uses the same WorkOS environment.";

export class ConvexAuthConfigurationError extends Error {
  constructor(message = missingConvexAuthMessage) {
    super(message);
    this.name = "ConvexAuthConfigurationError";
  }
}

class ConvexUnauthorizedError extends Error {
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

async function getConvexAuthToken() {
  const requestToken = resolveWorkOSRequestAccessToken({
    dedicatedHeader: getRequestHeader(WORKOS_ACCESS_TOKEN_HEADER),
    authorization: getRequestHeader("authorization"),
  });
  if (requestToken) {
    return requestToken;
  }

  const authState = await getAuth();

  if (!authState.user) {
    throw new ConvexUnauthorizedError();
  }

  return authState.accessToken;
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

export async function convexAction<Action extends FunctionReference<"action">>(
  action: Action,
  args: FunctionArgs<Action>,
): Promise<FunctionReturnType<Action>> {
  const token = await getConvexAuthToken();

  if (!token) {
    throw new ConvexUnauthorizedError();
  }

  return fetchAction(action, args, { token, url: getConvexUrl() });
}
