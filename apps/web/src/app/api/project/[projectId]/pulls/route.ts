import { api } from "@autopr/backend/convex/_generated/api";
import { fetchGithubPullRequests } from "@autopr/backend/convex/lib/github_oauth";
import { auth } from "@clerk/nextjs/server";

import { convexQuery } from "@/lib/convex-server";
import { getGithubOAuthToken, GithubConnectionError, safeErrorMessage } from "@/lib/github-oauth-server";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const authState = await auth();

  if (!authState.userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;
  const project = await convexQuery(api.projects.get, { projectId });

  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  try {
    const token = await getGithubOAuthToken(authState.userId);
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
