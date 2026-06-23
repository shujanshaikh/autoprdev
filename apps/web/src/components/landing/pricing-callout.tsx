import { cn } from "@autopr/ui/lib/utils";
import { buttonVariants } from "@autopr/ui/components/button";
import { CodexLogo } from "@/components/icons/codex-logo";
import { useScrollReveal } from "@/components/landing/use-scroll-reveal";

const infoItems = [
  {
    title: "Bring your own Codex connection",
    description:
      "Authorize through device code and keep model traffic tied to your ChatGPT subscription.",
  },
  {
    title: "Pay for the sandbox you use",
    description:
      "AutoPR tracks Daytona compute costs in settings and keeps token routing out of the markup story.",
  },
] as const;

export function PricingCallout() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section
      id="billing"
      ref={ref}
      className={cn(
        "landing-section landing-section-dark relative isolate px-5 py-20 sm:px-8 sm:py-24 lg:px-12",
      )}
    >
      <div
        className={cn(
          "landing-reveal mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.9fr_1fr]",
          isVisible && "is-visible",
        )}
      >
        <div>
          <CodexLogo className="size-10 text-[color:var(--landing-accent)]" />
          <p className="mt-8 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--landing-accent-strong)]">
            Codex and billing
          </p>
          <h2 className="mt-4 max-w-3xl text-balance text-[clamp(2.2rem,5vw,5rem)] font-semibold leading-[0.96] tracking-normal text-[color:var(--landing-ink)]">
            Tokens stay yours. Compute stays visible.
          </h2>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-[color:var(--landing-muted)] sm:text-base">
            AutoPR is built around your Codex connection and isolated Daytona runtime, so the commercial story is legible: authorize models through your subscription and inspect sandbox spend in the workspace.
          </p>
        </div>

        <div className="grid gap-3 self-end">
          {infoItems.map((item) => (
            <article
              key={item.title}
              className="border border-[color:var(--landing-line)] bg-[color:var(--landing-panel)] p-5"
            >
              <p className="text-base font-semibold text-[color:var(--landing-ink)]">{item.title}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--landing-muted)]">
                {item.description}
              </p>
            </article>
          ))}
          <div className="mt-3">
            {/* react-doctor-disable-next-line react-doctor/tanstack-start-no-anchor-element -- This intentionally navigates to the auth API endpoint. */}
            <a
              href="/api/auth/sign-in?returnTo=%2Fdashboard"
              className={cn(
                buttonVariants({ variant: "default", size: "lg" }),
                "h-11 rounded-none px-5",
              )}
            >
              Start with your GitHub repo
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
