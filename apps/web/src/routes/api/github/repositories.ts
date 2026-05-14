import { createFileRoute } from "@tanstack/react-router";
import { fetchGithubRepositories } from "@autopr/backend/convex/lib/github_oauth";
import { auth } from "@clerk/tanstack-react-start/server";

import { getGithubOAuthToken, GithubConnectionError, safeErrorMessage } from "#/lib/github-oauth-server";

async function GET() {
  const authState = await auth();

  if (!authState.userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const token = await getGithubOAuthToken(authState.userId);
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
    handlers: { GET: async ({ request, params }: { request: Request; params: any }) => GET(request, { params: Promise.resolve(params) } as any) },
  },
});
