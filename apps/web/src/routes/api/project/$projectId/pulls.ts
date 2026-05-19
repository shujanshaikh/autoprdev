import { createFileRoute } from "@tanstack/react-router";
import { api } from "@autopr/backend/convex/_generated/api";
import { fetchGithubPullRequests } from "@autopr/backend/convex/lib/github_oauth";

import { convexQuery } from "#/lib/convex-server";
import { getGithubOAuthToken, GithubConnectionError, requireWorkOSAuth, safeErrorMessage } from "#/lib/github-oauth-server";

async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await convexQuery(api.projects.get, { projectId });

  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  try {
    const authState = await requireWorkOSAuth();
    const token = await getGithubOAuthToken(authState.user.id, authState.organizationId);
    const pulls = await fetchGithubPullRequests(token, project.repoOwner, project.repoName);

    return Response.json({
      project: {
        projectId: project.projectId,
        repoFullName: project.repoFullName,
        githubUrl: project.githubUrl,
      },
      pulls,
    });
  } catch (error) {
    if (error instanceof GithubConnectionError) {
      return Response.json({ code: "GITHUB_NOT_CONNECTED", error: error.message }, { status: 401 });
    }

    return Response.json({ error: safeErrorMessage(error, "Could not load pull requests.") }, { status: 502 });
  }
}

export const Route = createFileRoute("/api/project/$projectId/pulls")({
  server: {
    handlers: { GET: async ({ request, params }: { request: Request; params: any }) => GET(request, { params: Promise.resolve(params) } as any) },
  },
});
