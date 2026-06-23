import { cn } from "@autopr/ui/lib/utils";
import { buttonVariants } from "@autopr/ui/components/button";
import { ModeToggle } from "#/components/mode-toggle";
import { ArrowRight } from "lucide-react";

const lightHeroImage =
  "https://pub-0423ac2cbe034b45b505d5c8dfd5f072.r2.dev/Screenshot%202026-06-23%20at%201.19.43%E2%80%AFPM.png";
const darkHeroImage =
  "https://pub-0423ac2cbe034b45b505d5c8dfd5f072.r2.dev/Screenshot%202026-06-23%20at%201.16.25%E2%80%AFPM.png";

const navLinks = [
  { label: "Support", href: "#support" },
] as const;

export function HeroSection() {
  return (
    <section className="landing-hero relative isolate min-h-[86svh] overflow-hidden px-5 text-[color:var(--landing-hero-foreground)] sm:px-8 lg:px-12">
      <img
        src={lightHeroImage}
        alt="AutoPR product workspace with an agent thread and code review surfaces"
        width={2940}
        height={1846}
        fetchPriority="high"
        loading="eager"
        decoding="async"
        className="landing-hero-image landing-hero-image--light absolute inset-0 size-full object-cover object-top"
      />
      <img
        src={darkHeroImage}
        alt="AutoPR product workspace with an agent thread and code review surfaces"
        width={2940}
        height={1846}
        fetchPriority="high"
        loading="eager"
        decoding="async"
        className="landing-hero-image landing-hero-image--dark absolute inset-0 size-full object-cover object-top"
      />
      <div className="landing-hero-scrim absolute inset-0" />

      <div className="relative z-10 mx-auto flex min-h-[86svh] w-full max-w-7xl flex-col">
        <nav className="flex items-center justify-between gap-4 py-5" aria-label="Landing page">
          <a
            href="#top"
            className="shrink-0 font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-[color:var(--landing-hero-foreground)]"
          >
            AUTOPR
          </a>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 sm:gap-5">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--landing-hero-muted)] transition hover:text-[color:var(--landing-hero-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:tracking-[0.18em]"
              >
                {link.label}
              </a>
            ))}
            {/* react-doctor-disable-next-line react-doctor/tanstack-start-no-anchor-element -- This intentionally navigates to the auth API endpoint. */}
            <a
              href="/api/auth/sign-in?returnTo=%2Fdashboard"
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--landing-accent-strong)] transition hover:text-[color:var(--landing-hero-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              Sign in
            </a>
            <ModeToggle
              presentation="switch"
              className="border-[color:var(--landing-hero-foreground)] bg-[color-mix(in_oklch,var(--landing-hero-panel)_94%,var(--background))] text-[color:var(--landing-hero-foreground)] hover:border-[color:var(--landing-hero-foreground)] hover:text-[color:var(--landing-hero-foreground)]"
            />
          </div>
        </nav>

        <div className="flex flex-1 items-end pb-10 pt-14 lg:pb-14 lg:pt-20">
          <div className="max-w-4xl">
            <p className="landing-hero-in font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--landing-accent-strong)]">
              Hosted code-agent workspaces for GitHub repos
            </p>
            <h1 className="landing-hero-in-delayed mt-5 text-balance font-mono text-[clamp(2.6rem,10vw,7.6rem)] font-semibold uppercase leading-[0.9] tracking-[0.08em] text-[color:var(--landing-hero-foreground)]">
              AUTOPR
            </h1>
            <div className="landing-hero-in-late mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              {/* react-doctor-disable-next-line react-doctor/tanstack-start-no-anchor-element -- This intentionally navigates to the auth API endpoint. */}
              <a
                href="/api/auth/sign-in?returnTo=%2Fdashboard"
                className={cn(
                  buttonVariants({ variant: "default", size: "lg" }),
                  "h-11 rounded-none px-5",
                )}
              >
                Start with a repo
                <ArrowRight className="size-4" aria-hidden />
              </a>
              <a
                href="#support"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "h-11 rounded-none border-[color:var(--landing-hero-panel-border)] bg-[color:var(--landing-hero-panel)] px-5 text-[color:var(--landing-hero-foreground)] hover:bg-muted hover:text-foreground",
                )}
              >
                See supported surfaces
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
