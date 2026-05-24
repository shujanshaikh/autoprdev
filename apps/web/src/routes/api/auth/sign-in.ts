import { createFileRoute } from "@tanstack/react-router";
import { getSignInUrl } from "@workos/authkit-tanstack-react-start";

const DEFAULT_RETURN_TO = "/dashboard";

async function GET({ request }: { request: Request }) {
  const returnTo = new URL(request.url).searchParams.get("returnTo") ?? DEFAULT_RETURN_TO;
  const signInUrl = await getSignInUrl({ data: returnTo });

  return new Response(null, {
    status: 307,
    headers: { Location: signInUrl },
  });
}

export const Route = createFileRoute("/api/auth/sign-in")({
  server: {
    handlers: { GET },
  },
});
