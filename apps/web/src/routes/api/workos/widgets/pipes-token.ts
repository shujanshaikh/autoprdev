import { createFileRoute } from "@tanstack/react-router";

import { getGithubWidgetToken, GithubConnectionError, requireWorkOSAuth, safeErrorMessage } from "#/lib/github-oauth-server";

async function GET() {
  try {
    const authState = await requireWorkOSAuth();

    if (!authState.organizationId) {
      return Response.json(
        {
          code: "WORKOS_ORGANIZATION_REQUIRED",
          error:
            "Your WorkOS session does not have an organization. Create an organization in WorkOS, add this user as a member, and sign in with organization selection enabled.",
        },
        { status: 400 },
      );
    }

    const token = await getGithubWidgetToken(authState.user.id, authState.organizationId);

    return Response.json({ token });
  } catch (error) {
    const status = error instanceof GithubConnectionError ? 401 : 500;
    return Response.json(
      { error: safeErrorMessage(error, "Could not create a WorkOS widget token.") },
      { status },
    );
  }
}

export const Route = createFileRoute("/api/workos/widgets/pipes-token")({
  server: {
    handlers: { GET },
  },
});
