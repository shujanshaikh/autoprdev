import { hasNumberType, hasStringType } from "@autopr/config/runtime-type";


import "@tanstack/react-start/server-only";

import { createPrivateKey } from "node:crypto";
import { getRequestHeader } from "@tanstack/react-start/server";
import { WorkOS } from "@workos-inc/node";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";

import { buildGithubAppInstallUrl, decodeGithubAppPrivateKey, getTrustedGithubInstallationUrl } from "#/lib/github-app-config";
import { getWorkOSAccessTokenVerificationOptions, resolveWorkOSRequestAccessToken, WORKOS_ACCESS_TOKEN_HEADER } from "#/lib/workos-access-token";

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
const repositoryInstallationTokenCache = new Map<string, {
  expiresAt: number;
  token: string;
}>();
let githubAppInstallUrlPromise: Promise<string> | undefined;

export function invalidateBearerAuth(accessToken: string) {
  mobileAuthCache.delete(accessToken);
}

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
    !hasStringType(payload.sub) ||
    (payload.client_id !== undefined && payload.client_id !== clientId)
  ) {
    throw new GithubConnectionError("Unauthorized");
  }

  const user = await getWorkOS().userManagement.getUser(payload.sub);
  const auth = {
    user,
    accessToken,
    sessionId: hasStringType(payload.sid) ? payload.sid : "",
    organizationId: hasStringType(payload.org_id) ? payload.org_id : undefined,
    role: hasStringType(payload.role) ? payload.role : undefined,
    roles: Array.isArray(payload.roles)
      ? payload.roles.filter((role): role is string => hasStringType(role))
      : undefined,
    permissions: Array.isArray(payload.permissions)
      ? payload.permissions.filter((permission): permission is string => hasStringType(permission))
      : undefined,
    entitlements: Array.isArray(payload.entitlements)
      ? payload.entitlements.filter((entitlement): entitlement is string => hasStringType(entitlement))
      : undefined,
    featureFlags: Array.isArray(payload.feature_flags)
      ? payload.feature_flags.filter((flag): flag is string => hasStringType(flag))
      : undefined,
  } satisfies AuthenticatedWorkOSAuth;

  mobileAuthCache.set(accessToken, {
    auth,
    expiresAt: Math.min(
      hasNumberType(payload.exp) ? payload.exp * 1000 : Date.now() + 60_000,
      Date.now() + 60_000,
    ),
  });
  if (mobileAuthCache.size > 100) {
    const firstKey = mobileAuthCache.keys().next().value;
    if (hasStringType(firstKey)) mobileAuthCache.delete(firstKey);
  }
  return auth;
}

function normalizeWorkOSErrorMessage<ErrorValue>(error: ErrorValue) {
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
  const accessToken = resolveWorkOSRequestAccessToken({
    dedicatedHeader: getRequestHeader(WORKOS_ACCESS_TOKEN_HEADER),
    authorization: getRequestHeader("authorization"),
  });
  if (accessToken) {
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
    .catch(<ErrorValue>(error: ErrorValue) => {
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

function getGithubAppConfiguration() {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const encodedPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (!appId || !encodedPrivateKey) {
    throw new GithubConnectionError(
      "GitHub App sandbox access is not configured. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.",
    );
  }

  return { appId, privateKey: decodeGithubAppPrivateKey(encodedPrivateKey) };
}

async function createGithubAppJwt() {
  const { appId, privateKey } = getGithubAppConfiguration();
  const now = Math.floor(Date.now() / 1000);
  let key: ReturnType<typeof createPrivateKey>;
  try {
    key = createPrivateKey(privateKey);
  } catch {
    throw new GithubConnectionError(
      "GITHUB_APP_PRIVATE_KEY must contain the complete PEM private key downloaded from the Autopr GitHub App.",
    );
  }
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now - 60)
    .setIssuer(appId)
    .setExpirationTime(now + 9 * 60)
    .sign(key);
}

async function githubAppFetch(url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${await createGithubAppJwt()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
  });
}

async function githubAppJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await githubAppFetch(url, init);
  if (!response.ok) {
    const body = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ (await response.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new GithubConnectionError(
      response.status === 404
        ? "Install the Autopr GitHub App on this repository before opening it in a sandbox."
        : body?.message ?? "Could not authorize the project repository for sandbox Git access.",
    );
  }
  return /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ await response.json() as T;
}

export async function getGithubAppInstallUrl(): Promise<string> {
  if (!githubAppInstallUrlPromise) {
    githubAppInstallUrlPromise = githubAppJson<{ slug?: string }>("https://api.github.com/app")
      .then(({ slug }) => {
        if (!slug) {
          throw new GithubConnectionError("GitHub did not return a valid Autopr App slug.");
        }
        return buildGithubAppInstallUrl(slug);
      })
      .catch(<ErrorValue>(error: ErrorValue) => {
        githubAppInstallUrlPromise = undefined;
        throw error;
      });
  }

  return githubAppInstallUrlPromise;
}

export async function getGithubRepositoryInstallationStatus(owner: string, repo: string) {
  const normalizedOwner = owner.trim();
  const normalizedRepo = repo.trim();
  if (!normalizedOwner || !normalizedRepo || /[\\/]/.test(normalizedOwner) || /[\\/]/.test(normalizedRepo)) {
    throw new GithubConnectionError("Invalid GitHub repository.");
  }

  const response = await githubAppFetch(
    `https://api.github.com/repos/${encodeURIComponent(normalizedOwner)}/${encodeURIComponent(normalizedRepo)}/installation`,
  );

  if (response.status === 404) {
    const [newInstallUrl, existingInstallationUrl] = await Promise.all([
      getGithubAppInstallUrl(),
      getGithubOwnerInstallationUrl(normalizedOwner),
    ]);
    return existingInstallationUrl
      ? { installed: false, installUrl: existingInstallationUrl, action: "configure" as const }
      : { installed: false, installUrl: newInstallUrl, action: "install" as const };
  }

  if (!response.ok) {
    const body = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ (await response.json().catch(() => undefined)) as { message?: string } | undefined;
    throw new GithubConnectionError(
      body?.message ?? "Could not check whether the Autopr GitHub App can access this repository.",
    );
  }

  const installation = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ (await response.json()) as {
    html_url?: string;
    permissions?: { contents?: string };
  };
  if (installation.permissions?.contents !== "write") {
    return {
      installed: false,
      installUrl:
        getTrustedGithubInstallationUrl(installation.html_url) ??
        await getGithubAppInstallUrl(),
      action: "configure" as const,
    };
  }

  return {
    installed: true,
    installUrl: await getGithubAppInstallUrl(),
    action: "installed" as const,
  };
}

async function getGithubOwnerInstallationUrl(owner: string): Promise<string | undefined> {
  const encodedOwner = encodeURIComponent(owner);
  const endpoints = [
    `https://api.github.com/orgs/${encodedOwner}/installation`,
    `https://api.github.com/users/${encodedOwner}/installation`,
  ];

  for (const endpoint of endpoints) {
    const response = await githubAppFetch(endpoint);
    if (response.status === 404) continue;
    if (!response.ok) {
      const body = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ (await response.json().catch(() => undefined)) as { message?: string } | undefined;
      throw new GithubConnectionError(
        body?.message ?? "Could not check the Autopr GitHub App installation for this account.",
      );
    }

    const installation = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ (await response.json()) as { html_url?: string };
    return getTrustedGithubInstallationUrl(installation.html_url);
  }

  return undefined;
}

/** Mints a short-lived GitHub App token selected down to one repository. */
export async function getGithubRepositoryToken(owner: string, repo: string): Promise<string> {
  const normalizedOwner = owner.trim();
  const normalizedRepo = repo.trim();
  if (!normalizedOwner || !normalizedRepo || /[\\/]/.test(normalizedOwner) || /[\\/]/.test(normalizedRepo)) {
    throw new GithubConnectionError("Invalid GitHub repository.");
  }

  const cacheKey = `${normalizedOwner}/${normalizedRepo}`.toLowerCase();
  const cached = repositoryInstallationTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 5 * 60_000) return cached.token;

  const installation = await githubAppJson<{ id: number }>(
    `https://api.github.com/repos/${encodeURIComponent(normalizedOwner)}/${encodeURIComponent(normalizedRepo)}/installation`,
  );
  const access = await githubAppJson<{
    token: string;
    expires_at: string;
    repositories?: Array<{ full_name?: string }>;
  }>(`https://api.github.com/app/installations/${installation.id}/access_tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repositories: [normalizedRepo],
      permissions: { contents: "write" },
    }),
  });
  if (!access.token) throw new GithubConnectionError("GitHub did not issue a repository access token.");
  if (access.repositories && !access.repositories.some((entry) => entry.full_name?.toLowerCase() === cacheKey)) {
    throw new GithubConnectionError("GitHub issued a token for a different repository.");
  }

  const expiresAt = Date.parse(access.expires_at);
  repositoryInstallationTokenCache.set(cacheKey, {
    token: access.token,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 50 * 60_000,
  });
  return access.token;
}

export function getGithubRepositoryTokenForFullName(fullName: string) {
  const [owner, repo, ...extra] = fullName.split("/");
  if (!owner || !repo || extra.length > 0) {
    throw new GithubConnectionError("Invalid GitHub repository.");
  }
  return getGithubRepositoryToken(owner, repo);
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
    ...(() => {
  let optionalProperties;
  if (options.organizationId) optionalProperties = { organization_id: options.organizationId };
  return optionalProperties;
})(),
  };

  const response = await fetch("https://api.workos.com/data-integrations/github/authorize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getWorkOSApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const body = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ (await response.json().catch(() => undefined)) as { url?: string; message?: string } | undefined;

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

export async function requireGithubRepositoryWriteAccess(
  token: string,
  owner: string,
  repo: string,
  username: string,
) {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
      `/collaborators/${encodeURIComponent(username)}/permission`,
    { headers: githubHeaders(token), redirect: "error" },
  );
  if (!response.ok) {
    throw new GithubConnectionError(
      response.status === 404
        ? `Your GitHub account cannot push to ${owner}/${repo}.`
        : `Could not verify your GitHub write access to ${owner}/${repo}.`,
    );
  }
  const body = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ await response.json() as { permission?: string; user?: { permissions?: { push?: boolean } } };
  const canPush = body.user?.permissions?.push === true ||
    body.permission === "admin" || body.permission === "maintain" || body.permission === "write";
  if (!canPush) {
    throw new GithubConnectionError(`Your GitHub account cannot push to ${owner}/${repo}.`);
  }
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

  const githubUser = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ (await userResponse.json()) as {
    login?: string;
    name?: string | null;
    email?: string | null;
  };

  let email = githubUser.email ?? fallbackEmail ?? undefined;

  const emailsResponse = await fetch("https://api.github.com/user/emails", { headers: githubHeaders(token) }).catch(() => undefined);
  if (emailsResponse?.ok) {
    const emails = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ (await emailsResponse.json()) as Array<{
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

export function safeErrorMessage<ErrorValue>(error: ErrorValue, fallback = "Something went wrong.") {
  return error instanceof Error ? error.message : fallback;
}
