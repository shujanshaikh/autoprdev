import { createFileRoute, redirect } from "@tanstack/react-router";

import { getGithubAuthorizationUrl, GithubConnectionError, requireWorkOSAuth, safeErrorMessage } from "#/lib/github-oauth-server";
import { getSafeRedirectUrl } from "#/lib/safe-redirect";

async function GET({ request }: { request: Request }) {
  let authState: Awaited<ReturnType<typeof requireWorkOSAuth>>;
  let returnTo: string;

  try {
    authState = await requireWorkOSAuth();
    const url = new URL(request.url);
    returnTo = getSafeRedirectUrl(url.searchParams.get("returnTo"));

    if (!authState.organizationId) {
      return Response.json(
        {
          error:
            "Your WorkOS session does not include an organization. Create or select an organization before connecting GitHub.",
        },
        { status: 400 },
      );
    }
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    return Response.json(
      { error: safeErrorMessage(error, "Could not start GitHub authorization.") },
      { status: error instanceof GithubConnectionError ? 400 : 500 },
    );
  }

  let href: string;
  try {
    href = await getGithubAuthorizationUrl({
      userId: authState.user.id,
      organizationId: authState.organizationId,
      returnTo,
    });
  } catch (error) {
    return Response.json(
      { error: safeErrorMessage(error, "Could not start GitHub authorization.") },
      { status: error instanceof GithubConnectionError ? 400 : 500 },
    );
  }

  throw redirect({ href });
}

export const Route = createFileRoute("/api/github/connect")({
  server: {
    handlers: { GET },
  },
});
