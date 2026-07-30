import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

const signInHref = "/api/auth/sign-in?returnTo=%2Fdashboard";

const navLinks = [
  { label: "Workflow", href: "#workflow" },
  { label: "Examples", href: "#examples" },
  { label: "Why AutoPR", href: "#why" },
] as const;

const steps = [
  {
    index: "01",
    label: "Connect",
    title: "Your repo, ready in seconds.",
    copy: "Point AutoPR at a GitHub repository and branch. A fresh Daytona workspace spins up with the full project context.",
  },
  {
    index: "02",
    label: "Delegate",
    title: "Describe the change. Stay in control.",
    copy: "Say what you want in plain language and watch the agent inspect, edit, and validate the code — live.",
  },
  {
    index: "03",
    label: "Ship",
    title: "Review the work, not the busywork.",
    copy: "Inspect every changed file, then open a pull request without losing the conversation behind it.",
  },
] as const;

const examples = [
  { index: "01", title: "Refactor auth middleware to refresh tokens" },
  { index: "02", title: "Add rate limiting to the upload endpoint" },
  { index: "03", title: "Fix the flaky timezone test in CI" },
] as const;

const features = [
  {
    index: "01",
    label: "Isolated by default",
    copy: "Every task runs in its own Daytona workspace — full repo, dependencies, and toolchain, with nothing touching your machine.",
  },
  {
    index: "02",
    label: "Your Codex subscription",
    copy: "Authorize once and keep model traffic on your own plan. No token markup, no mystery line items.",
  },
  {
    index: "03",
    label: "Diffs you can trust",
    copy: "Every thread ends in a reviewable diff. Walk each changed file before anything leaves the branch.",
  },
  {
    index: "04",
    label: "Straight to a pull request",
    copy: "Open the PR from the same thread and keep the conversation attached to the code it produced.",
  },
] as const;

type ArrowTone = "accent" | "accent-2";

function Cross({ dark = false, className = "" }: { dark?: boolean; className?: string }) {
  return <span aria-hidden="true" className={`lp-cross${dark ? " lp-cross-dark" : ""}${className ? ` ${className}` : ""}`} />;
}

function ArrowButton({ href, tone = "accent", className = "", children }: { href: string; tone?: ArrowTone; className?: string; children: ReactNode }) {
  return (
    // react-doctor-disable-next-line react-doctor/tanstack-start-no-anchor-element -- Auth endpoint intentionally performs a document navigation.
    <a href={href} className={`lp-arrow lp-arrow-${tone}${className ? ` ${className}` : ""}`}>
      {children}
    </a>
  );
}

function Wordmark() {
  return (
    <a href="#top" className="lp-wordmark" aria-label="AutoPR home">
      <span className="lp-wordmark-tile">
        <img src="/images/landing/autopr-mark.png" alt="" aria-hidden="true" />
      </span>
      <span className="lp-wordmark-text">AutoPR</span>
    </a>
  );
}

function Header() {
  return (
    <header className="lp-header">
      <div className="lp-frame lp-header-inner">
        <Wordmark />
        <nav className="lp-nav" aria-label="Primary">
          {navLinks.map(({ label, href }) => (
            <a key={href} href={href} className="lp-nav-link">
              {label}
            </a>
          ))}
        </nav>
        <div className="lp-header-actions">
          {/* react-doctor-disable-next-line react-doctor/tanstack-start-no-anchor-element -- Auth endpoint intentionally performs a document navigation. */}
          <a href={signInHref} className="lp-signin">
            Sign in
          </a>
          <ArrowButton href={signInHref} tone="accent" className="lp-arrow-sm">
            <span className="hidden sm:inline">Get started</span>
            <span className="sm:hidden">Start</span>
          </ArrowButton>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="lp-hero">
      <div className="lp-hero-bg" aria-hidden="true" />
      <div className="lp-frame lp-hero-inner">
        <Cross className="left-[-6.5px] top-[88px]" />
        <Cross className="right-[-6.5px] top-[88px]" />
        <Cross className="bottom-[88px] left-[-6.5px]" />
        <Cross className="bottom-[88px] right-[-6.5px]" />

        <p className="lp-kicker lp-rise">Autonomous code agent</p>
        <h1 className="lp-h1 lp-rise lp-rise-1">
          Turn tasks into
          <br />
          pull requests.
        </h1>
        <p className="lp-lede lp-rise lp-rise-2">
          Describe the change. AutoPR opens an isolated workspace, edits and validates your code, then hands you a pull request ready to review.
        </p>
        <div className="lp-hero-ctas lp-rise lp-rise-2">
          <ArrowButton href={signInHref} tone="accent">
            Start building
          </ArrowButton>
          <a href="#workflow" className="lp-text-link">
            How it works <ArrowDown aria-hidden="true" className="size-3.5" />
          </a>
        </div>
        <p className="lp-proof lp-rise lp-rise-3">
          <span>Bring your Codex subscription</span>
          <i aria-hidden="true">·</i>
          <span>Isolated Daytona runtime</span>
          <i aria-hidden="true">·</i>
          <span>GitHub native</span>
        </p>
      </div>
    </section>
  );
}

function WorkflowSection() {
  return (
    <section id="workflow" className="lp-dark-zone scroll-mt-16">
      <div className="lp-ticks lp-ticks-dark" aria-hidden="true" />
      <div className="lp-frame lp-dark-frame">
        <span className="lp-tag">How it works</span>
        <Cross dark className="left-[-6.5px] top-[48px]" />
        <Cross dark className="right-[-6.5px] top-[48px]" />
        <Cross dark className="bottom-[48px] left-[-6.5px]" />
        <Cross dark className="bottom-[48px] right-[-6.5px]" />

        <div className="lp-dark-head">
          <div>
            <p className="lp-kicker lp-kicker-dark">Workflow</p>
            <h2 className="lp-h2 lp-h2-accent-2">
              From one sentence
              <br />
              to a ready pull request.
            </h2>
            <p className="lp-lede-dark">
              AutoPR constructs a live workspace around your codebase, then lets a focused agent do the grinding while you make the calls.
            </p>
          </div>
          <ArrowButton href={signInHref} tone="accent-2" className="hidden xl:inline-flex">
            Start building
          </ArrowButton>
        </div>

        <div className="lp-steps">
          {steps.map((step) => (
            <article key={step.index} className="lp-step">
              <p className="lp-step-top">
                <span className="lp-step-index">{step.index}</span>
                <span className="lp-step-label">{step.label}</span>
              </p>
              <h3>{step.title}</h3>
              <p className="lp-step-copy">{step.copy}</p>
            </article>
          ))}
        </div>

        <div id="examples" className="lp-examples scroll-mt-24">
          <div className="lp-examples-head">
            <span>Example tasks</span>
            <span>Describe it — the agent ships it</span>
          </div>
          <div className="lp-example-grid">
            {examples.map((example) => (
              // react-doctor-disable-next-line react-doctor/tanstack-start-no-anchor-element -- Auth endpoint intentionally performs a document navigation.
              <a key={example.index} href={signInHref} className="lp-example">
                <span className="lp-example-head">
                  <span>{example.index}</span>
                  <span className="lp-example-dash" aria-hidden="true" />
                  <span>autopr</span>
                </span>
                <span className="lp-example-title">{example.title}</span>
                <span className="lp-example-foot">
                  Try this task
                  <ArrowRight aria-hidden="true" className="size-3" />
                </span>
              </a>
            ))}
          </div>
          <div className="lp-examples-cta">
            <ArrowButton href={signInHref} tone="accent-2">
              Start with your repo
            </ArrowButton>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section id="why" className="scroll-mt-16">
      <div className="lp-frame lp-light-inner">
        <p className="lp-kicker">Why AutoPR</p>
        <h2 className="lp-h2">
          Everything between
          <br />
          the idea and the merge.
        </h2>
        <p className="lp-lede-center">
          AutoPR keeps the whole loop in one place — the workspace, the conversation, the diff, and the pull request.
        </p>
        <div className="lp-feature-grid">
          {features.map((feature) => (
            <article key={feature.index} className="lp-feature">
              <p className="lp-feature-label">
                <span>{feature.index}</span>
                <span aria-hidden="true">/</span>
                <strong>{feature.label}</strong>
              </p>
              <p className="lp-feature-copy">{feature.copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaSection() {
  return (
    <section className="lp-cta">
      <div className="lp-cta-bg" aria-hidden="true" />
      <div className="lp-frame lp-cta-inner">
        <Cross className="left-[-6.5px] top-[40px]" />
        <Cross className="right-[-6.5px] top-[40px]" />
        <Cross className="bottom-[40px] left-[-6.5px]" />
        <Cross className="bottom-[40px] right-[-6.5px]" />

        <p className="lp-kicker">Get started</p>
        <h2 className="lp-h2">Your next pull request can start with one sentence.</h2>
        <ArrowButton href={signInHref} tone="accent">
          Start building free
        </ArrowButton>
        <p className="lp-proof">
          <span>No credit card required</span>
          <i aria-hidden="true">·</i>
          <span>Bring your Codex subscription</span>
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-ticks lp-ticks-dark" aria-hidden="true" />
      <div className="lp-frame lp-footer-inner">
        <div className="lp-footer-top">
          <Wordmark />
          <nav className="lp-footer-links" aria-label="Footer">
            <Link to="/dashboard" className="lp-footer-link">
              Open app
            </Link>
            {/* react-doctor-disable-next-line react-doctor/tanstack-start-no-anchor-element -- Auth endpoint intentionally performs a document navigation. */}
            <a href={signInHref} className="lp-footer-link">
              Sign in
            </a>
            {/* react-doctor-disable-next-line react-doctor/tanstack-start-no-anchor-element -- Auth endpoint intentionally performs a document navigation. */}
            <a href={signInHref} className="lp-footer-link">
              Get started
            </a>
          </nav>
        </div>
        <div className="lp-footer-bottom">
          <p>© 2026 AutoPR</p>
          <p>Isolated Daytona runtime · Powered by your Codex subscription</p>
        </div>
      </div>
    </footer>
  );
}

export function LandingPage() {
  return (
    <div id="top" className="lp">
      <Header />
      <main>
        <Hero />
        <WorkflowSection />
        <FeaturesSection />
        <CtaSection />
      </main>
      <Footer />
    </div>
  );
}
