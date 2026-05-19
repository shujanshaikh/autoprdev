import { createFileRoute, Navigate } from "@tanstack/react-router";
import { getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { Loader2 } from "lucide-react";

import { AuthAccessCard } from "#/components/auth-access-card";

export const Route = createFileRoute("/sign-in")({
  loader: async () => ({
    signInUrl: await getSignInUrl({ data: "/dashboard" }),
  }),
  component: SignIn,
});

function SignIn() {
  const { signInUrl } = Route.useLoaderData();

  return (
    <>
      <Unauthenticated>
        <AuthAccessCard signInHref={signInUrl} />
      </Unauthenticated>

      <Authenticated>
        <Navigate to="/dashboard" replace />
      </Authenticated>

      <AuthLoading>
        <div className="sign-in-shell relative grid min-h-svh place-items-center overflow-hidden bg-background">
          <div className="sign-in-grid pointer-events-none absolute inset-0 z-0" aria-hidden="true" />
          <div className="relative z-10 flex flex-col items-center gap-3">
            <Loader2 className="size-5 animate-spin text-primary/60" aria-hidden="true" />
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              loading
            </span>
          </div>
        </div>
      </AuthLoading>
    </>
  );
}
