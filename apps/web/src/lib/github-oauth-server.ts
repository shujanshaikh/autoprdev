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

export function authenticatedGithubCloneUrl(token: string, owner: string, repo: string) {
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}.git`;
}

export function safeErrorMessage(error: unknown, fallback = "Something went wrong.") {
  return error instanceof Error ? error.message : fallback;
}
