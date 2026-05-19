import { createFileRoute } from "@tanstack/react-router";
import { api } from "@autopr/backend/convex/_generated/api";
import { fetchGithubBranches } from "@autopr/backend/convex/lib/github_oauth";
import { z } from "zod";

import { convexMutation, convexQuery } from "#/lib/convex-server";
import { SandboxGitConflictError, switchProjectSandboxBranch } from "#/lib/daytona-project-sandbox";
import { getGithubOAuthToken, GithubConnectionError, requireWorkOSAuth, safeErrorMessage } from "#/lib/github-oauth-server";

const requestSchema = z.object({
  branch: z.string().min(1),
});

async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Select a branch." }, { status: 400 });
  }


  const { projectId } = await params;
  const { branch } = parsed.data;
  const project = await convexQuery(api.projects.get, { projectId });

  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  if (project.sandboxStatus !== "ready" || !project.sandboxId) {
    return Response.json({ error: "Project sandbox is not ready yet." }, { status: 409 });
  }

  const previousBranch = project.currentBranch ?? project.repoBranch ?? project.defaultBranch;

  try {
    const authState = await requireWorkOSAuth();
    const token = await getGithubOAuthToken(authState.user.id, authState.organizationId);
    const branches = await fetchGithubBranches(token, project.repoOwner, project.repoName);

    if (!branches.some((entry) => entry.name === branch)) {
      return Response.json({ error: "That branch no longer exists on GitHub." }, { status: 404 });
    }

    await convexMutation(api.projects.markBranchSwitching, { projectId, repoBranch: branch });

    try {
      await switchProjectSandboxBranch({ sandboxId: project.sandboxId, branch });
      await convexMutation(api.projects.markBranchSwitchReady, { projectId, repoBranch: branch });

      return Response.json({ projectId, branch, status: "ready" });
    } catch (error) {
      const message = safeErrorMessage(error, "Could not switch branches.");
      await convexMutation(api.projects.markBranchSwitchFailed, {
        projectId,
        branchSwitchError: message,
        previousBranch,
      });

      return Response.json(
        { error: message },
        { status: error instanceof SandboxGitConflictError ? 409 : 500 },
      );
    }
  } catch (error) {
    if (error instanceof GithubConnectionError) {
      return Response.json({ code: "GITHUB_NOT_CONNECTED", error: error.message }, { status: 401 });
    }

    return Response.json({ error: safeErrorMessage(error, "Could not switch branches.") }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/project/$projectId/branch")({
  server: {
    handlers: { POST: async ({ request, params }: { request: Request; params: any }) => POST(request, { params: Promise.resolve(params) } as any) },
  },
});
