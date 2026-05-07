import { api } from "@autopr/backend/convex/_generated/api";
import { fetchGithubBranches, getGithubRepository } from "@autopr/backend/convex/lib/github_oauth";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { convexMutation, convexQuery } from "@/lib/convex-server";
import { createProjectSandbox } from "@/lib/daytona-project-sandbox";
import {
  authenticatedGithubCloneUrl,
  getGithubOAuthToken,
  GithubConnectionError,
  safeErrorMessage,
} from "@/lib/github-oauth-server";

const requestSchema = z.object({
  repository: z.object({
    id: z.number(),
    fullName: z.string(),
    owner: z.string(),
    name: z.string(),
    htmlUrl: z.string(),
    cloneUrl: z.string(),
    defaultBranch: z.string(),
  }),
  branch: z.string().min(1),
});

export async function POST(req: Request) {
  const authState = await auth();

  if (!authState.userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Select a GitHub repository and branch." }, { status: 400 });
  }


  const { repository, branch } = parsed.data;

  try {
    const token = await getGithubOAuthToken(authState.userId);
    const verifiedRepo = await getGithubRepository(token, repository.owner, repository.name);

    if (verifiedRepo.id !== repository.id) {
      return Response.json({ error: "GitHub repository mismatch. Refresh and try again." }, { status: 400 });
    }

    const branches = await fetchGithubBranches(token, repository.owner, repository.name);
    if (!branches.some((entry) => entry.name === branch)) {
      return Response.json({ error: "That branch no longer exists on GitHub." }, { status: 404 });
    }

    const project = await convexMutation(api.projects.ensureForGithubSelection, {
      githubRepositoryId: verifiedRepo.id,
      githubUrl: verifiedRepo.htmlUrl,
      cloneUrl: verifiedRepo.cloneUrl,
      repoFullName: verifiedRepo.fullName,
      repoOwner: verifiedRepo.owner,
      repoName: verifiedRepo.name,
      defaultBranch: verifiedRepo.defaultBranch,
      repoBranch: branch,
    });

    if (!project.created) {
      const existingBranch = branch;

      if (project.sandboxStatus === "ready" && project.sandboxId) {
        const projectBeforeSwitch = await convexQuery(api.projects.get, { projectId: project.projectId });
        const previousBranch = projectBeforeSwitch?.currentBranch ?? projectBeforeSwitch?.repoBranch ?? projectBeforeSwitch?.defaultBranch;

        await convexMutation(api.projects.markBranchSwitching, {
          projectId: project.projectId,
          repoBranch: existingBranch,
        });

        try {
          const { switchProjectSandboxBranch } = await import("@/lib/daytona-project-sandbox");
          await switchProjectSandboxBranch({ sandboxId: project.sandboxId, branch: existingBranch });
          await convexMutation(api.projects.markBranchSwitchReady, {
            projectId: project.projectId,
            repoBranch: existingBranch,
          });
        } catch (error) {
          const message = safeErrorMessage(error, "Could not switch the existing project branch.");
          await convexMutation(api.projects.markBranchSwitchFailed, {
            projectId: project.projectId,
            branchSwitchError: message,
            previousBranch,
          });
          return Response.json({ projectId: project.projectId, reused: true, sandboxStatus: "failed", error: message }, { status: 409 });
        }
      }

      return Response.json({
        projectId: project.projectId,
        reused: true,
        sandboxStatus: project.sandboxStatus,
      });
    }

    try {
      const sandbox = await createProjectSandbox({
        authenticatedCloneUrl: authenticatedGithubCloneUrl(token, verifiedRepo.owner, verifiedRepo.name),
        branch,
      });

      await convexMutation(api.projects.markSandboxReady, {
        projectId: project.projectId,
        sandboxId: sandbox.sandboxId,
        sandboxName: sandbox.sandboxName,
        sandboxSnapshot: sandbox.sandboxSnapshot,
        sandboxWorkDir: sandbox.sandboxWorkDir,
      });

      return Response.json({
        projectId: project.projectId,
        reused: false,
        sandboxStatus: "ready",
      });
    } catch (error) {
      const message = safeErrorMessage(error, "Could not create or clone the sandbox.");
      await convexMutation(api.projects.markSandboxFailed, {
        projectId: project.projectId,
        sandboxError: message,
      });

      return Response.json(
        {
          projectId: project.projectId,
          reused: false,
          sandboxStatus: "failed",
          error: `Could not create or clone the sandbox: ${message}`,
        },
        { status: 500 },
      );
    }
  } catch (error) {
    if (error instanceof GithubConnectionError) {
      return Response.json({ code: "GITHUB_NOT_CONNECTED", error: error.message }, { status: 401 });
    }

    return Response.json({ error: safeErrorMessage(error, "Could not create the project.") }, { status: 500 });
  }
}
