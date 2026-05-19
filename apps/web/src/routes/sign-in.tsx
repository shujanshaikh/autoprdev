import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSignInUrl } from "@workos/authkit-tanstack-react-start";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>) => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : "/dashboard",
  }),
  loader: async ({ location }) => {
    const search = location.search as { returnTo?: string };
    throw redirect({ href: await getSignInUrl({ data: search.returnTo ?? "/dashboard" }) });
  },
});
