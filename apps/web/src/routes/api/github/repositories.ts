import { createFileRoute } from "@tanstack/react-router";
import { fetchGithubRepositories } from "@autopr/backend/convex/lib/github_oauth";

import { getGithubOAuthToken, GithubConnectionError, requireWorkOSAuth, safeErrorMessage } from "#/lib/github-oauth-server";

async function GET() {
  try {
    const authState = await requireWorkOSAuth();
    const token = await getGithubOAuthToken(authState.user.id, authState.organizationId);
    const repositories = await fetchGithubRepositories(token);

    return Response.json({ repositories });
  } catch (error) {
    if (error instanceof GithubConnectionError) {
      return Response.json({ code: "GITHUB_NOT_CONNECTED", error: error.message }, { status: 401 });
    }

    return Response.json({ error: safeErrorMessage(error, "Could not load GitHub repositories.") }, { status: 502 });
  }
}

export const Route = createFileRoute("/api/github/repositories")({
  server: {
    handlers: { GET },
  },
});
