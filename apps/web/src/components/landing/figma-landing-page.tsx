import { cn } from "@autopr/ui/lib/utils";
import { Bot, GitCompareArrows, Github, ShieldCheck } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";

import { ModeToggle } from "#/components/mode-toggle";

const FIGMA_WIDTH = 1512;

function u(px: number) {
  return `${px}px`;
}

function place(x: number, y: number, width: number, height?: number) {
  return {
    left: u(x),
    top: u(y),
    width: u(width),
    ...(height == null ? {} : { height: u(height) }),
  };
}

const featureCards = [
  {
    x: 548,
    y: 68,
    icon: Github,
    title: "Connect a GitHub repo",
    body: "Choose a repository and branch so each run starts from real project context.",
  },
  {
    x: 548,
    y: 178,
    icon: ShieldCheck,
    title: "Run in an isolated sandbox",
    body: "AutoPR prepares a Daytona workspace where the agent can inspect, edit, and run commands.",
  },
  {
    x: 548,
    y: 288,
    icon: Bot,
    title: "Guide a Codex thread",
    body: "Describe the task, attach context, and follow the agent conversation as work happens.",
  },
  {
    x: 548,
    y: 398,
    icon: GitCompareArrows,
    title: "Review and open a PR",
    body: "Inspect diffs and runtime output, then create a GitHub pull request when the changes are ready.",
  },
] as const;

function subscribeToViewportScale(onStoreChange: () => void) {
  window.addEventListener("resize", onStoreChange);

  return () => window.removeEventListener("resize", onStoreChange);
}

function getViewportScaleSnapshot() {
  return Math.min(1, window.innerWidth / FIGMA_WIDTH);
}

function getServerScaleSnapshot() {
  return 1;
}

function useFigmaScale() {
  return useSyncExternalStore(
    subscribeToViewportScale,
    getViewportScaleSnapshot,
    getServerScaleSnapshot,
  );
}

function AutoPrLogo({
  x,
  y,
  scale = 1,
}: {
  x: number;
  y: number;
  scale?: number;
}) {
  return (
    <a
      href="#top"
      aria-label="AUTOPR"
      className="absolute flex items-center text-[color:var(--landing-ink)]"
      style={place(x, y, 219 * scale, 61 * scale)}
    >
      <img
        src="/images/landing/autopr-mark.png"
        alt=""
        aria-hidden="true"
        className="landing-logo-mark block shrink-0 object-contain"
        style={{ width: u(44 * scale), height: u(44 * scale) }}
      />
      <span
        className="font-display font-medium leading-none"
        style={{
          marginLeft: u(11 * scale),
          fontSize: u(26 * scale),
          lineHeight: u(28 * scale),
          letterSpacing: u(-1 * scale),
        }}
      >
        AUTOPR
      </span>
    </a>
  );
}

function MobileLogo() {
  return (
    <a
      href="#top"
      aria-label="AUTOPR"
      className="flex min-w-0 items-center text-[color:var(--landing-ink)]"
    >
      <img
        src="/images/landing/autopr-mark.png"
        alt=""
        aria-hidden="true"
        className="landing-logo-mark block h-7 w-7 shrink-0 object-contain"
      />
      <span className="ml-2 font-display text-lg font-medium leading-none tracking-[-0.04em] min-[380px]:text-xl">
        AUTOPR
      </span>
    </a>
  );
}

function HeroMascot() {
  return (
    <>
      <img src="/images/landing/mascot-spark.svg" alt="" aria-hidden="true" className="absolute landing-muted-asset" style={place(488, 152, 85, 83)} />
      <img src="/images/landing/mascot-body.svg" alt="" aria-hidden="true" className="absolute landing-muted-asset" style={place(518, 178, 169, 208)} />
      <img src="/images/landing/mascot-leg-right.svg" alt="" aria-hidden="true" className="absolute landing-muted-asset" style={place(564.5, 282.3, 30.3, 44.2)} />
      <img src="/images/landing/mascot-leg-left.svg" alt="" aria-hidden="true" className="absolute landing-muted-asset" style={place(614.3, 282.3, 30.3, 44.2)} />
    </>
  );
}

function FigmaButton({
  href,
  children,
  x,
  y,
  width,
  height,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  x: number;
  y: number;
  width: number;
  height: number;
  variant?: "primary" | "secondary";
}) {
  return (
    <a
      href={href}
      className={cn(
        "absolute flex items-center justify-center rounded-[var(--radius-pill)] border border-[color:var(--landing-line)] font-medium",
        "transition-transform hover:-translate-y-0.5 active:translate-y-px",
        variant === "primary"
          ? "border-[color:var(--landing-strong-line)] bg-[color:var(--landing-button)] text-[color:var(--landing-button-fg)] hover:bg-[color:var(--landing-button-hover)]"
          : "bg-[color:var(--landing-panel)] text-[color:var(--landing-ink)] hover:border-[color:var(--landing-strong-line)] hover:bg-[color:var(--landing-accent-panel)]",
      )}
      style={{
        ...place(x, y, width, height),
        fontSize: u(18),
        lineHeight: u(28),
      }}
    >
      {children}
    </a>
  );
}

function MobileLandingPage() {
  return (
    <main className="landing-mobile w-full lg:hidden">
      <header className="sticky top-0 z-20 border-b border-[color:var(--landing-line)] bg-[color:var(--landing-paper)]/88 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-[430px] items-center justify-between px-4 md:max-w-[760px] md:px-6">
          <MobileLogo />
          <div className="flex shrink-0 items-center gap-2">
            <ModeToggle
              presentation="switch"
              className="border-[color:var(--landing-strong-line)] bg-[color:var(--landing-panel)] text-[color:var(--landing-ink)] hover:border-[color:var(--landing-highlight)] hover:bg-[color:var(--landing-accent-panel)] hover:text-[color:var(--landing-ink)]"
            />
            <a
              href="/api/auth/sign-in?returnTo=%2Fdashboard"
              className="flex h-8 items-center justify-center rounded-[var(--radius-pill)] bg-[color:var(--landing-button)] px-3 text-sm font-medium text-[color:var(--landing-button-fg)]"
            >
              Start
            </a>
          </div>
        </div>
      </header>

      <section aria-label="Hero" className="mx-auto w-full max-w-[430px] px-5 pb-8 pt-8 md:max-w-[760px] md:px-6 md:pb-12 md:pt-10">
        <p className="font-mono text-xs font-normal uppercase tracking-[0.18em] text-[color:var(--landing-highlight)]">
          Meet
        </p>
        <div className="mt-4 flex items-start justify-between gap-3 md:items-center md:gap-8">
          <div className="min-w-0">
            <h1 className="font-display text-5xl font-medium leading-none tracking-[-0.05em] text-[color:var(--landing-ink)] min-[380px]:text-6xl md:text-7xl">
              AUTOPR<span className="text-[color:var(--landing-highlight)]">.</span>
            </h1>
            <p className="mt-3 max-w-[17rem] text-xl font-normal leading-tight text-[color:var(--landing-ink)] min-[380px]:text-2xl md:max-w-[24rem] md:text-3xl">
              Your autonomous code companion.
            </p>
          </div>
          <img
            src="/images/landing/mascot-body.svg"
            alt=""
            aria-hidden="true"
            className="landing-muted-asset mt-1 h-20 w-16 shrink-0 object-contain min-[380px]:h-24 min-[380px]:w-20 md:h-32 md:w-28"
          />
        </div>
        <p className="mt-4 text-[15px] leading-6 text-[color:var(--landing-muted)] md:max-w-[38rem] md:text-base md:leading-7">
          AutoPR reviews, refactors, and ships pull requests for you, so your team stays in flow while the busywork takes care of itself.
        </p>
        <div className="mt-5 grid gap-3 min-[420px]:grid-cols-2 md:max-w-[34rem]">
          <a
            href="/api/auth/sign-in?returnTo=%2Fdashboard"
            className="flex h-11 items-center justify-center rounded-[var(--radius-pill)] border border-[color:var(--landing-strong-line)] bg-[color:var(--landing-button)] px-4 text-sm font-medium text-[color:var(--landing-button-fg)]"
          >
            Start Building
          </a>
          <a
            href="#mobile-agents"
            className="flex h-11 items-center justify-center rounded-[var(--radius-pill)] border border-[color:var(--landing-line)] bg-[color:var(--landing-panel)] px-4 text-sm font-medium text-[color:var(--landing-ink)]"
          >
            See Agents
          </a>
        </div>
        <div className="mt-6 overflow-hidden rounded-lg border border-[color:var(--landing-line)] bg-[color:var(--landing-panel)] md:mt-8">
          <img
            src="/images/autopr-product-screenshot.jpg"
            alt="AutoPR product screenshot"
            className="h-44 w-full object-cover object-left-top min-[420px]:h-52 md:h-[360px]"
          />
        </div>
      </section>

      <section id="mobile-agents" className="mx-auto w-full max-w-[430px] px-5 py-10 md:max-w-[760px] md:px-6 md:py-14">
        <p className="font-mono text-xs font-normal uppercase tracking-[0.18em] text-[color:var(--landing-highlight)]">
          Supported workflow
        </p>
        <h2 className="mt-3 max-w-[18rem] font-display text-3xl font-medium leading-tight tracking-[-0.04em] text-[color:var(--landing-ink)] md:max-w-[34rem] md:text-4xl">
          From repo to reviewed PR
        </h2>
        <p className="mt-4 text-[15px] leading-6 text-[color:var(--landing-muted)] md:max-w-[36rem] md:text-base md:leading-7">
          AutoPR connects GitHub, runs Codex in a sandbox, and keeps the review flow visible before you ship.
        </p>

        <div className="mt-6 divide-y divide-[color:var(--landing-line)] rounded-lg border border-[color:var(--landing-strong-line)] bg-[color:var(--landing-muted-panel)]">
          {featureCards.map((card, index) => {
            const Icon = card.icon;

            return (
              <article key={card.title} className="flex gap-3 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[color:var(--landing-strong-line)] bg-[color:var(--landing-accent-panel)]">
                  <Icon className="h-5 w-5 text-[color:var(--landing-highlight)]" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-base font-normal leading-5 text-[color:var(--landing-ink)]">
                      {card.title}
                    </h3>
                    <span className="shrink-0 font-mono text-xs text-[color:var(--landing-highlight)]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--landing-muted)]">
                    {card.body}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section id="mobile-pricing" aria-label="Pricing" className="mx-auto h-3 w-full max-w-[430px] md:max-w-[760px]" />

      <section className="overflow-hidden pb-10 pt-8 text-[color:var(--landing-console-fg)]">
        <div
          className="landing-gradient-spotlight mx-5 rounded-[var(--radius-xxl)] py-10 md:mx-auto md:max-w-[760px] md:py-12"
        >
          <div className="mx-auto w-full max-w-[430px] px-5 md:max-w-[760px] md:px-8">
            <h2 className="font-display text-3xl font-medium leading-tight tracking-[-0.04em] min-[380px]:text-4xl">
              Ship more. Fix less.
            </h2>
            <p className="mt-4 max-w-sm text-[15px] leading-6 text-[color:var(--landing-console-muted)]">
              Connect your repo in under two minutes and meet your new autonomous teammate.
            </p>
            <a
              href="/api/auth/sign-in?returnTo=%2Fdashboard"
              className="mt-6 flex h-11 w-full max-w-56 items-center justify-center rounded-[var(--radius-pill)] border border-[color:var(--landing-console-line)] bg-[color:var(--landing-console-button)] px-4 text-sm font-medium text-[color:var(--landing-console-button-fg)]"
            >
              Start Building Free
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-[color:var(--landing-line)] bg-[color:var(--landing-footer)] pb-9 pt-7 text-[color:var(--landing-ink)]">
        <div className="mx-auto w-full max-w-[430px] px-5 md:max-w-[760px] md:px-6">
          <MobileLogo />
          <p className="mt-5 max-w-xs font-mono text-xs leading-5 text-[color:var(--landing-muted)]">
            © 2026 AutoPR. Built for developers who'd rather be building.
          </p>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({ card, index }: { card: (typeof featureCards)[number]; index: number }) {
  const Icon = card.icon;

  return (
    <article
      className={cn(
        "absolute flex items-start border-t border-[color:var(--landing-line)] text-[color:var(--landing-ink)]",
        index === 0 && "border-t-0",
      )}
      style={{
        ...place(card.x, card.y, 800, 90),
        paddingTop: u(18),
      }}
    >
      <div className="flex shrink-0 items-center justify-center rounded-[7px] border border-[color:var(--landing-strong-line)] bg-[color:var(--landing-accent-panel)]" style={{ width: u(42), height: u(42) }}>
        <Icon className="text-[color:var(--landing-highlight)]" aria-hidden="true" style={{ width: u(20), height: u(20) }} />
      </div>
      <div style={{ marginLeft: u(22), width: u(560) }}>
        <h3 className="font-normal" style={{ fontSize: u(23), lineHeight: u(28) }}>
          {card.title}
        </h3>
        <p style={{ marginTop: u(8), fontSize: u(16), lineHeight: u(24), color: "var(--landing-muted)" }}>
          {card.body}
        </p>
      </div>
      <span className="ml-auto font-mono text-[color:var(--landing-highlight)]" style={{ paddingTop: u(4), fontSize: u(13), lineHeight: u(16) }}>
        {String(index + 1).padStart(2, "0")}
      </span>
    </article>
  );
}

export function FigmaLandingPage() {
  const scale = useFigmaScale();
  const landingStyle = { "--landing-scale": String(scale) } as CSSProperties;

  return (
    <div
      id="top"
      className="landing-page relative flex min-h-0 flex-1 justify-center overflow-x-clip overflow-y-auto"
      style={landingStyle}
    >
      <MobileLandingPage />
      <div className="landing-figma-frame hidden lg:block">
        <main className="landing-figma-stage">
        <header className="absolute left-0 right-0 top-0 z-20 bg-[color:var(--landing-paper)]/70 backdrop-blur-md border-b border-[color:var(--landing-line)]/30" style={{ height: u(56) }}>
          <AutoPrLogo x={28} y={0} scale={0.75} />
          <nav className="absolute flex items-center gap-8" aria-label="Landing page" style={{ left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }}>
            <a href="/dashboard" className="font-mono font-medium text-[color:var(--landing-ink)]/60 transition-colors hover:text-[color:var(--landing-ink)]" style={{ fontSize: u(14), lineHeight: u(20) }}>Dashboard</a>
            <a href="#agents" className="font-mono font-medium text-[color:var(--landing-ink)]/60 transition-colors hover:text-[color:var(--landing-ink)]" style={{ fontSize: u(14), lineHeight: u(20) }}>Agents</a>
            <a href="#pricing" className="font-mono font-medium text-[color:var(--landing-ink)]/60 transition-colors hover:text-[color:var(--landing-ink)]" style={{ fontSize: u(14), lineHeight: u(20) }}>Pricing</a>
          </nav>
          <div className="absolute" style={{ right: u(166), top: "50%", transform: "translateY(-50%)" }}>
            <ModeToggle
              presentation="switch"
              className="border-[color:var(--landing-strong-line)] bg-[color:var(--landing-panel)] text-[color:var(--landing-ink)] hover:border-[color:var(--landing-highlight)] hover:bg-[color:var(--landing-accent-panel)] hover:text-[color:var(--landing-ink)]"
            />
          </div>
          <a href="/api/auth/sign-in?returnTo=%2Fdashboard" className="absolute flex items-center justify-center rounded-[var(--radius-pill)] bg-[color:var(--landing-button)] font-medium text-[color:var(--landing-button-fg)] transition-colors hover:bg-[color:var(--landing-button-hover)]" style={{ right: u(28), top: '50%', transform: 'translateY(-50%)', padding: `${u(7)} ${u(18)}`, fontSize: u(13), lineHeight: u(18) }}>Start Building</a>
        </header>

        <section aria-label="Hero">
          <p className="absolute font-mono font-normal uppercase text-[color:var(--landing-highlight)]" style={{ ...place(78, 165, 150), fontSize: u(22), lineHeight: "1" }}>Meet</p>
          <img src="/images/landing/scribble-arrow.svg" alt="" aria-hidden="true" className="absolute rotate-[50.95deg] landing-muted-asset" style={place(46, 210, 55, 19)} />
          <h1 className="absolute font-display font-medium text-[color:var(--landing-ink)]" style={{ ...place(118, 211, 520), fontSize: u(100), lineHeight: "0.85", letterSpacing: "-5px" }}>AUTOPR<span className="text-[color:var(--landing-highlight)]">.</span></h1>
          <HeroMascot />
          <p className="absolute font-normal text-[color:var(--landing-ink)]" style={{ ...place(99, 304, 360), fontSize: u(34), lineHeight: "1.13", letterSpacing: "-1px" }}>Your autonomous code companion.</p>
          <p className="absolute text-[color:var(--landing-muted)]" style={{ ...place(96, 404, 633), fontSize: u(18), lineHeight: u(23.4), letterSpacing: "-0.18px" }}>AutoPR reviews, refactors, and ships pull requests for you, so your team stays in flow while the busywork takes care of itself.</p>
          <FigmaButton href="/api/auth/sign-in?returnTo=%2Fdashboard" x={119} y={496} width={205} height={64}>Start Building</FigmaButton>
          <FigmaButton href="#agents" x={383} y={496} width={224} height={64} variant="secondary">
            <img src="/images/landing/watch-demo-icon.svg" alt="" aria-hidden="true" className="mr-[.45em] landing-muted-asset" style={{ width: u(20), height: u(20) }} />
            See Agents
          </FigmaButton>
          <div className="absolute overflow-hidden rounded-lg border border-[color:var(--landing-line)] bg-[color:var(--landing-panel)]" style={place(756, 185, 711, 551)}>
            <img src="/images/autopr-product-screenshot.jpg" alt="AutoPR product screenshot" className="size-full object-cover object-top" />
          </div>
          <div className="absolute overflow-hidden" style={place(1355, 101, 104, 85)}>
            <img src="/images/landing/hero-peek.png" alt="" aria-hidden="true" className="absolute max-w-none landing-neutral-image" style={{ left: "-13.11%", top: "-12.28%", width: "139.5%", height: "157.55%" }} />
          </div>
        </section>

        <section id="agents" className="absolute left-0 right-0 bg-[color:var(--landing-paper)]" style={{ top: u(780), height: u(520) }}>
          <p className="absolute font-mono font-normal uppercase text-[color:var(--landing-highlight)]" style={{ ...place(96, 72, 250), fontSize: u(13), lineHeight: u(18), letterSpacing: "0.18em" }}>Supported workflow</p>
          <h2 className="absolute font-display font-medium text-[color:var(--landing-ink)]" style={{ ...place(96, 108, 420), fontSize: u(43), lineHeight: u(46), letterSpacing: "-2.15px" }}>From repo to reviewed PR</h2>
          <p className="absolute text-[color:var(--landing-muted)]" style={{ ...place(96, 240, 370), fontSize: u(18), lineHeight: u(23.4), letterSpacing: "-0.18px" }}>AutoPR connects GitHub, runs Codex in a sandbox, and keeps the review flow visible before you ship.</p>
          <div className="absolute bg-[color:var(--landing-line)]" aria-hidden="true" style={place(506, 68, 1, 420)} />
          {featureCards.map((card, index) => <FeatureCard key={card.title} card={card} index={index} />)}
        </section>

        <section id="pricing" aria-label="Pricing" className="absolute left-0 right-0 bg-[color:var(--landing-paper)]" style={{ top: u(1300), height: u(28) }} />

        <section className="absolute left-0 right-0 overflow-hidden" style={{ top: u(1356), height: u(364) }}>
          <div className="landing-gradient-spotlight absolute rounded-[var(--radius-xxl)]" style={{ left: u(96), top: u(36), width: u(1320), height: u(300) }} />
          <div className="absolute text-[color:var(--landing-console-fg)]" style={place(112, 111, 520, 180)}>
            <h2 className="font-display font-medium" style={{ fontSize: u(41), lineHeight: u(42), letterSpacing: "-2px" }}>Ship more. Fix less.</h2>
            <p style={{ marginTop: u(12), width: u(420), fontSize: u(18), lineHeight: u(23.4), letterSpacing: "-0.18px", color: "var(--landing-console-muted)" }}>Connect your repo in under two minutes and meet your new autonomous teammate.</p>
            <a href="/api/auth/sign-in?returnTo=%2Fdashboard" className="absolute flex items-center justify-center rounded-[var(--radius-pill)] border border-[color:var(--landing-console-line)] bg-[color:var(--landing-console-button)] font-medium text-[color:var(--landing-console-button-fg)]" style={{ left: 0, top: u(132), width: u(206), height: u(51), fontSize: u(16), lineHeight: u(24) }}>Start Building Free</a>
          </div>
          <nav className="absolute flex font-mono text-[color:var(--landing-console-fg)]" aria-label="Footer links on dark band" style={{ ...place(730, 174, 230, 24), gap: u(36), fontSize: u(14), lineHeight: u(24) }}>
            <a href="#top">Docs</a>
            <a href="#agents">GitHub</a>
            <a href="#pricing">Privacy</a>
          </nav>
        </section>

        <footer className="absolute left-0 right-0 border-t border-[color:var(--landing-line)] bg-[color:var(--landing-footer)] text-[color:var(--landing-ink)]" style={{ top: u(1730), height: u(170) }}>
          <AutoPrLogo x={96} y={62} scale={0.78} />
          <p className="absolute text-right font-mono" style={{ ...place(740, 75, 640), fontSize: u(13), lineHeight: u(20), color: "var(--landing-muted)" }}>© 2026 AutoPR. Built for developers who'd rather be building.</p>
        </footer>
        </main>
      </div>
    </div>
  );
}
