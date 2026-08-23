import { hasStringType } from "@autopr/config/runtime-type";
import { type JsonObject } from "@autopr/config/runtime-value";

import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSignUpUrl } from "@workos/authkit-tanstack-react-start";

import { getSafeRedirectUrl } from "#/lib/safe-redirect";

export const Route = createFileRoute("/sign-up")({
  validateSearch: (search: JsonObject) => ({
    returnTo: getSafeRedirectUrl(hasStringType(search.returnTo) ? search.returnTo : undefined),
  }),
  loader: async ({ location }) => {
    const search = location.search satisfies { returnTo?: string };
    const safeReturnTo = getSafeRedirectUrl(search.returnTo);
    const safeSignUpUrl = await getSignUpUrl({ data: safeReturnTo });

    throw redirect({ href: safeSignUpUrl });
  },
});
