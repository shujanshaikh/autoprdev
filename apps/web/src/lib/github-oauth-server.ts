import "@tanstack/react-start/server-only";

import { getRequestHeader } from "@tanstack/react-start/server";
import { WorkOS } from "@workos-inc/node";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { getWorkOSAccessTokenVerificationOptions } from "#/lib/workos-access-token";

export class GithubConnectionError extends Error {
  constructor(message = "Connect GitHub to continue.") {
    super(message);
    this.name = "GithubConnectionError";
  }
}

type AuthKitState = Awaited<ReturnType<typeof getAuth>>;
type AuthenticatedWorkOSAuth = {
  user: NonNullable<AuthKitState["user"]>;
  accessToken: string;
  sessionId: string;
  organizationId?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
  entitlements?: string[];
  featureFlags?: string[];
};

const mobileAuthCache = new Map<string, {
  expiresAt: number;
  auth: AuthenticatedWorkOSAuth;
}>();

function getWorkOSClientId() {
  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!clientId) {
    throw new GithubConnectionError("Set WORKOS_CLIENT_ID before authenticating.");
  }
  return clientId;
}

async function getBearerAuth(accessToken: string): Promise<AuthenticatedWorkOSAuth> {
  const cached = mobileAuthCache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) return cached.auth;

  const clientId = getWorkOSClientId();
  const jwks = createRemoteJWKSet(
    new URL(`https://api.workos.com/sso/jwks/${encodeURIComponent(clientId)}`),
  );
  const { payload } = await jwtVerify(
    accessToken,
    jwks,
    getWorkOSAccessTokenVerificationOptions(clientId),
  );

  if (
    typeof payload.sub !== "string" ||
    (payload.client_id !== undefined && payload.client_id !== clientId)
  ) {
    throw new GithubConnectionError("Unauthorized");
  }

  const user = await getWorkOS().userManagement.getUser(payload.sub);
  const auth = {
    user,
    accessToken,
    sessionId: typeof payload.sid === "string" ? payload.sid : "",
    organizationId: typeof payload.org_id === "string" ? payload.org_id : undefined,
    role: typeof payload.role === "string" ? payload.role : undefined,
    roles: Array.isArray(payload.roles)
      ? payload.roles.filter((role): role is string => typeof role === "string")
      : undefined,
    permissions: Array.isArray(payload.permissions)
      ? payload.permissions.filter((permission): permission is string => typeof permission === "string")
      : undefined,
    entitlements: Array.isArray(payload.entitlements)
      ? payload.entitlements.filter((entitlement): entitlement is string => typeof entitlement === "string")
      : undefined,
    featureFlags: Array.isArray(payload.feature_flags)
      ? payload.feature_flags.filter((flag): flag is string => typeof flag === "string")
      : undefined,
  } satisfies AuthenticatedWorkOSAuth;

  mobileAuthCache.set(accessToken, {
    auth,
    expiresAt: Math.min(
      typeof payload.exp === "number" ? payload.exp * 1000 : Date.now() + 60_000,
      Date.now() + 60_000,
    ),
  });
  if (mobileAuthCache.size > 100) {
    const firstKey = mobileAuthCache.keys().next().value;
    if (typeof firstKey === "string") mobileAuthCache.delete(firstKey);
  }
  return auth;
}

function normalizeWorkOSErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return undefined;
  }

  if (error.message.includes("Data Integration not found") || error.message.includes("slug=github")) {
    return "GitHub is not configured in WorkOS Pipes. Add the GitHub provider in WorkOS Pipes before connecting repositories.";
  }

  return error.message;
}

function getWorkOS() {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) {
    throw new GithubConnectionError("Set WORKOS_API_KEY before connecting GitHub.");
  }

  return new WorkOS(apiKey);
}

function getWorkOSApiKey() {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) {
    throw new GithubConnectionError("Set WORKOS_API_KEY before connecting GitHub.");
  }

  return apiKey;
}

export async function requireWorkOSAuth(): Promise<AuthenticatedWorkOSAuth> {
  const authorization = getRequestHeader("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const accessToken = authorization.slice("Bearer ".length).trim();
    if (!accessToken) throw new GithubConnectionError("Unauthorized");

    try {
      return await getBearerAuth(accessToken);
    } catch (error) {
      if (error instanceof GithubConnectionError) throw error;
      throw new GithubConnectionError("Unauthorized");
    }
  }

  const authState = await getAuth();

  if (!authState.user) {
    throw new GithubConnectionError("Unauthorized");
  }

  return {
    ...authState,
    user: authState.user,
    accessToken: authState.accessToken ?? "",
    sessionId: authState.sessionId ?? "",
    organizationId: authState.organizationId ?? undefined,
  };
}

export async function getGithubOAuthToken(userId: string, organizationId?: string | null): Promise<string> {
  const response = await getWorkOS()
    .pipes.getAccessToken({
      provider: "github",
      userId,
      organizationId,
    })
    .catch((error: unknown) => {
      throw new GithubConnectionError(normalizeWorkOSErrorMessage(error) ?? "Could not load the connected GitHub token.");
    });

  if (!response.active) {
    throw new GithubConnectionError(
      response.error === "needs_reauthorization"
        ? "Reconnect GitHub to continue."
        : "Connect GitHub to continue.",
    );
  }

  const token = response.accessToken.accessToken;

  if (!token) {
    throw new GithubConnectionError();
  }

  if (response.accessToken.missingScopes.length > 0) {
    throw new GithubConnectionError(
      `Reconnect GitHub with the required scopes: ${response.accessToken.missingScopes.join(", ")}.`,
    );
  }

  return token;
}

export async function getGithubWidgetToken(userId: string, organizationId?: string) {
  if (!organizationId) {
    throw new GithubConnectionError("Select or create a WorkOS organization before connecting GitHub.");
  }

  const { token } = await getWorkOS().widgets.createToken({
    userId,
    organizationId,
  });

  return token;
}

export async function getGithubAuthorizationUrl(options: {
  userId: string;
  organizationId?: string | null;
  returnTo?: string;
}) {
  const requestBody = {
    user_id: options.userId,
    return_to: options.returnTo,
    ...(options.organizationId ? { organization_id: options.organizationId } : {}),
  };

  const response = await fetch("https://api.workos.com/data-integrations/github/authorize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getWorkOSApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const body = (await response.json().catch(() => undefined)) as { url?: string; message?: string } | undefined;

  if (!response.ok || !body?.url) {
    throw new GithubConnectionError(
      normalizeWorkOSErrorMessage(new Error(body?.message ?? "")) ?? body?.message ?? "Could not start GitHub authorization.",
    );
  }

  return body.url;
}

export interface GithubUserIdentity {
  username: string;
  name: string;
  email: string;
}

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function fetchGithubUserEmail(token: string, fallbackEmail?: string | null) {
  const userResponse = await fetch("https://api.github.com/user", { headers: githubHeaders(token) });
  if (!userResponse.ok) {
    throw new GithubConnectionError("Could not load the connected GitHub user.");
  }

  const githubUser = (await userResponse.json()) as {
    login?: string;
    name?: string | null;
    email?: string | null;
  };

  let email = githubUser.email ?? fallbackEmail ?? undefined;

  const emailsResponse = await fetch("https://api.github.com/user/emails", { headers: githubHeaders(token) }).catch(() => undefined);
  if (emailsResponse?.ok) {
    const emails = (await emailsResponse.json()) as Array<{
      email: string;
      primary?: boolean;
      verified?: boolean;
    }>;
    email =
      emails.find((item) => item.primary && item.verified)?.email ??
      emails.find((item) => item.verified)?.email ??
      emails.find((item) => item.primary)?.email ??
      emails[0]?.email ??
      email;
  }

  return {
    username: githubUser.login ?? "x-access-token",
    name: githubUser.name ?? githubUser.login,
    email,
  };
}

export async function getGithubUserIdentity(
  user: { firstName?: string | null; lastName?: string | null; email?: string | null },
  token: string,
): Promise<GithubUserIdentity> {
  const fallbackEmail = user.email;
  const githubUser = await fetchGithubUserEmail(token, fallbackEmail);
  const email = githubUser.email ?? fallbackEmail;

  if (!email) {
    throw new GithubConnectionError("Could not determine the connected GitHub user's email.");
  }

  const workosName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  const name = githubUser.name ?? (workosName || githubUser.username) ?? email.split("@")[0];

  return {
    username: githubUser.username,
    name,
    email,
  };
}

export function safeErrorMessage(error: unknown, fallback = "Something went wrong.") {
  return error instanceof Error ? error.message : fallback;
}
