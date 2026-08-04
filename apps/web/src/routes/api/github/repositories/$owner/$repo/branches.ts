import { createFileRoute } from "@tanstack/react-router";
import { fetchGithubBranches } from "@autopr/backend/convex/lib/github_oauth";

import {
  getGithubOAuthToken,
  getGithubRepositoryInstallationStatus,
  GithubConnectionError,
  requireWorkOSAuth,
  safeErrorMessage,
} from "#/lib/github-oauth-server";

async function GET(_req: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;

  try {
    const authState = await requireWorkOSAuth();
    const token = await getGithubOAuthToken(authState.user.id, authState.organizationId);
    const [branches, githubApp] = await Promise.all([
      fetchGithubBranches(token, owner, repo),
      getGithubRepositoryInstallationStatus(owner, repo),
    ]);

    return Response.json({ branches, githubApp });
  } catch (error) {
    if (error instanceof GithubConnectionError) {
      return Response.json({ code: "GITHUB_NOT_CONNECTED", error: error.message }, { status: 401 });
    }

    return Response.json({ error: safeErrorMessage(error, "Could not load GitHub branches.") }, { status: 502 });
  }
}

export const Route = createFileRoute("/api/github/repositories/$owner/$repo/branches")({
  server: {
    handlers: { GET: async ({ request, params }: { request: Request; params: any }) => GET(request, { params: Promise.resolve(params) } as any) },
  },
});
