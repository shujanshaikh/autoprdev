import { Link } from "@tanstack/react-router";
import { Authenticated, Unauthenticated } from "convex/react";
import type { ReactNode } from "react";

export function AuthGate({ children }: { children: ReactNode }) {
  return (
    <>
      <Authenticated>{children}</Authenticated>

      <Unauthenticated>
        <main className="grid min-h-svh place-items-center px-5">
          <Link
            to="/dashboard"
            className="px-4 py-2 text-sm text-foreground/70 transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
        </main>
      </Unauthenticated>
    </>
  );
}
