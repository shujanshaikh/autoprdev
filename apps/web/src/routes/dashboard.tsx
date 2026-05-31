import { createFileRoute } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useEffect } from "react";

import { LatestProjectEntry, LoadingState } from "#/components/latest-project-entry";

function SignInRedirect() {
  useEffect(() => {
    window.location.replace(`/api/auth/sign-in?returnTo=${encodeURIComponent("/dashboard")}`);
  }, []);

  return null;
}

function Dashboard() {
  return (
    <>
      <Authenticated>
        <LatestProjectEntry />
      </Authenticated>

      <Unauthenticated>
        <SignInRedirect />
      </Unauthenticated>

      <AuthLoading>
        <LoadingState />
      </AuthLoading>
    </>
  );
}

export const Route = createFileRoute("/dashboard")({ component: Dashboard });
