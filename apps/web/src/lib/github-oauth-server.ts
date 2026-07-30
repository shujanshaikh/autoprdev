import "@tanstack/react-start/server-only";

import { WorkOS } from "@workos-inc/node";
import { getAuth } from "@workos/authkit-tanstack-react-start";

export class GithubConnectionError extends Error {
  constructor(message = "Connect GitHub to continue.") {
    super(message);
    this.name = "GithubConnectionError";
  }
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

export async function requireWorkOSAuth() {
  const authState = await getAuth();

  if (!authState.user) {
    throw new GithubConnectionError("Unauthorized");
  }

  return authState;
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
