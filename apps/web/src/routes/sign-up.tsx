import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSignUpUrl } from "@workos/authkit-tanstack-react-start";

import { getSafeRedirectUrl } from "#/lib/safe-redirect";

export const Route = createFileRoute("/sign-up")({
  validateSearch: (search: Record<string, unknown>) => ({
    returnTo: getSafeRedirectUrl(typeof search.returnTo === "string" ? search.returnTo : undefined),
  }),
  loader: async ({ location }) => {
    const search = location.search as { returnTo?: string };
    const safeReturnTo = getSafeRedirectUrl(search.returnTo);
    const safeSignUpUrl = await getSignUpUrl({ data: safeReturnTo });

    throw redirect({ href: safeSignUpUrl });
  },
});
