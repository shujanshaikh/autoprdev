import { clerkClient } from "@clerk/nextjs/server";

export class GithubConnectionError extends Error {
  constructor(message = "Connect GitHub to continue.") {
    super(message);
    this.name = "GithubConnectionError";
  }
}

export async function getGithubOAuthToken(userId: string): Promise<string> {
  const client = await clerkClient();
  const response = await client.users.getUserOauthAccessToken(userId, "github");
  const token = response.data[0]?.token;

  if (!token) {
    throw new GithubConnectionError();
  }

  return token;
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

export async function getGithubUserIdentity(userId: string, token: string): Promise<GithubUserIdentity> {
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const fallbackEmail = user.primaryEmailAddress?.emailAddress;
  const githubUser = await fetchGithubUserEmail(token, fallbackEmail);
  const email = githubUser.email ?? fallbackEmail;

  if (!email) {
    throw new GithubConnectionError("Could not determine the connected GitHub user's email.");
  }

  const name =
    githubUser.name ??
    user.fullName ??
    user.username ??
    githubUser.username ??
    email.split("@")[0];

  return {
    username: githubUser.username,
    name,
    email,
  };
}

export function authenticatedGithubCloneUrl(token: string, owner: string, repo: string) {
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}.git`;
}

export function safeErrorMessage(error: unknown, fallback = "Something went wrong.") {
  return error instanceof Error ? error.message : fallback;
}
