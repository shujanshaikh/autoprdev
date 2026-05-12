import Link from "next/link";

import { CodexFloating } from "@/components/landing/codex-floating";
import { EmailCta } from "@/components/landing/email-cta";

export const metadata = {
  title: "Autopr | Cloud-native coding agents",
  description: "Run long-lived coding agents in isolated Daytona sandboxes connected to your GitHub repositories.",
};

export default function Home() {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-x-clip overflow-y-auto">
      <div className="border-b border-primary/15 bg-primary/[0.07] px-4 py-2 text-center text-[11px] font-medium tracking-wide text-primary-foreground/90 dark:text-primary-foreground/90">
        Sandbox billing only · Bring your Codex subscription, zero API markup from us
      </div>

      <nav
        className="pointer-events-none fixed right-5 top-[46%] z-20 hidden -translate-y-1/2 md:pointer-events-auto lg:block"
        aria-label="Section links"
      >
        <ul className="flex flex-col gap-7 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          <li>
            <Link
              href="/dashboard"
              className="pointer-events-auto transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Pricing
            </Link>
          </li>
          <li>
            <Link
              href="/dashboard"
              className="pointer-events-auto transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Docs
            </Link>
          </li>
          <li>
            <Link
              href="/dashboard"
              className="pointer-events-auto transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Sign in
            </Link>
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

          <EmailCta />
        </header>

        <CodexFloating />

        <footer className="relative z-10 mt-auto flex flex-wrap items-center justify-between gap-4 border-t border-border/50 pt-10 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>© 2026 autopr</span>          <div className="flex flex-wrap items-center gap-6">
            <Link href="/dashboard" className="hover:text-foreground">
              Dashboard
            </Link>
            <Link href="/dashboard" className="hover:text-foreground">
              Privacy
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
