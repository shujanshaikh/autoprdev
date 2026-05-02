import { fetchGithubBranches } from "@autopr/backend/convex/lib/github_oauth";
import { auth } from "@clerk/nextjs/server";

import { getGithubOAuthToken, GithubConnectionError, safeErrorMessage } from "@/lib/github-oauth-server";

export async function GET(_req: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const authState = await auth();

  if (!authState.userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { owner, repo } = await params;

  try {
    const token = await getGithubOAuthToken(authState.userId);
    const branches = await fetchGithubBranches(token, owner, repo);

    return Response.json({ branches });
  } catch (error) {
    if (error instanceof GithubConnectionError) {
      return Response.json({ code: "GITHUB_NOT_CONNECTED", error: error.message }, { status: 401 });
    }

    return Response.json({ error: safeErrorMessage(error, "Could not load GitHub branches.") }, { status: 502 });
  }
}
