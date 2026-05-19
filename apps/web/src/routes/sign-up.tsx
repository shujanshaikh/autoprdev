import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSignUpUrl } from "@workos/authkit-tanstack-react-start";

export const Route = createFileRoute("/sign-up")({
  validateSearch: (search: Record<string, unknown>) => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : "/dashboard",
  }),
  loader: async ({ location }) => {
    const search = location.search as { returnTo?: string };
    throw redirect({ href: await getSignUpUrl({ data: search.returnTo ?? "/dashboard" }) });
  },
});
