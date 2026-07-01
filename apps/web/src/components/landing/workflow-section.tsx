import { cn } from "@autopr/ui/lib/utils";
import { useScrollReveal } from "@/components/landing/use-scroll-reveal";

const steps = [
  {
    title: "Connect GitHub",
    description:
      "Authorize the workspace, browse repositories, and choose the repo AutoPR should operate on.",
  },
  {
    title: "Select a branch",
    description:
      "Fetch branches from GitHub, pick the base branch, and let AutoPR keep the project state in sync.",
  },
  {
    title: "Start Daytona",
    description:
      "Clone into an isolated sandbox, track the runtime state, and start or stop compute when needed.",
  },
  {
    title: "Prompt the agent",
    description:
      "Send text and images to a Codex-backed thread that can search, edit, write, and run commands.",
  },
  {
    title: "Inspect the run",
    description:
      "Open diffs, terminal sessions, desktop preview, usage details, and optional browser recordings.",
  },
  {
    title: "Open the PR",
    description:
      "Push an autopr/* branch and create a GitHub pull request from the thread's reviewed changes.",
  },
] as const;

export function WorkflowSection() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section
      id="workflow"
      ref={ref}
      className="landing-section landing-section-alt relative isolate px-5 py-20 sm:px-8 sm:py-24 lg:px-12"
    >
      <div className="mx-auto max-w-7xl">
        <p className="font-mono text-[10px] font-normal uppercase tracking-[0.22em] text-[color:var(--landing-amber)]">
          Runtime path
        </p>

        <h2 className="mt-4 max-w-3xl text-balance font-display text-[clamp(2rem,5vw,4.2rem)] font-normal leading-[0.98] tracking-normal text-[color:var(--landing-ink)]">
          The sequence is the product.
        </h2>

        <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-6">
          {steps.map((step, i) => (
            <article
              key={step.title}
              className={cn(
                "landing-reveal relative border border-[color:var(--landing-line)] bg-[color:var(--landing-panel)] p-5",
                "before:absolute before:left-5 before:top-0 before:h-1 before:w-16 before:bg-[color:var(--landing-amber)]",
                `landing-stagger-${i + 1}`,
                isVisible && "is-visible",
              )}
            >
              <div className="font-mono text-[11px] font-normal uppercase tracking-[0.18em] text-[color:var(--landing-amber)]">
                {String(i + 1).padStart(2, "0")}
              </div>

              <p className="mt-8 text-sm font-normal text-[color:var(--landing-ink)]">
                {step.title}
              </p>

              <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--landing-muted)]">
                {step.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
