import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";

import { LatestProjectEntry, LoadingState } from "#/components/latest-project-entry";
import { CodexFloating } from "@/components/landing/codex-floating";

export const metadata = {
  title: "Autopr | Cloud-native coding agents",
  description: "Run long-lived coding agents in isolated Daytona sandboxes connected to your GitHub repositories.",
};

function LandingHome() {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-x-clip overflow-y-auto">
      <nav
        className="pointer-events-none fixed right-5 top-[46%] z-20 hidden -translate-y-1/2 md:pointer-events-auto lg:block"
        aria-label="Section links"
      >
        <ul className="flex flex-col gap-7 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          <li>
            <Link
              to="/dashboard"
              className="pointer-events-auto transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Pricing
            </Link>
          </li>
          <li>
            <Link
              to="/dashboard"
              className="pointer-events-auto transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Docs
            </Link>
          </li>
          <li>
            <a
              href="/api/auth/sign-in?returnTo=%2Fdashboard"
              className="pointer-events-auto transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Sign in
            </a>
          </li>
        </ul>
      </nav>

      <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 pb-28 pt-12 sm:px-8 sm:pb-24 sm:pt-16 lg:px-12">
        <header className="relative z-10 mx-auto max-w-3xl text-center">
          <p className="mb-5 text-[13px] leading-relaxed text-muted-foreground sm:text-sm">
            Long-running coding agents in isolated cloud sandboxes. You pay for compute time, not tokens routed
            through our API.
          </p>
          <h1
            className="font-sans text-balance text-[clamp(1.65rem,5vw,2.65rem)] font-semibold uppercase leading-[1.05] tracking-[0.04em] text-foreground"
          >
            Autopr
            <span className="mx-2 inline-block align-middle text-muted-foreground/35">:</span>
            <span className="block sm:inline">The cloud-native coding agent</span>
          </h1>

        </header>

        <div className="relative z-10 mx-auto mt-12 flex w-full max-w-4xl justify-center">
          <img
            src="https://pub-0423ac2cbe034b45b505d5c8dfd5f072.r2.dev/autopr/480bfbf5-70be-4c01-a98e-a56ef026a0e8%20Copy.JPG"
            alt="Autopr product screenshot"
            className="w-full border border-border/40 shadow-lg"
          />
        </div>

        <CodexFloating />

        <footer className="relative z-10 mt-auto flex flex-wrap items-center justify-between gap-4 border-t border-border/50 pt-10 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>© 2026 autopr</span>          <div className="flex flex-wrap items-center gap-6">
            <Link to="/dashboard" className="hover:text-foreground">
              Open app
            </Link>
            <Link to="/dashboard" className="hover:text-foreground">
              Privacy
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}

function Home() {
  return (
    <>
      <Authenticated>
        <LatestProjectEntry />
      </Authenticated>

      <Unauthenticated>
        <LandingHome />
      </Unauthenticated>

      <AuthLoading>
        <LoadingState />
      </AuthLoading>
    </>
  );
}

export const Route = createFileRoute("/")({ component: Home });
