import { cn } from "@autopr/ui/lib/utils";
import {
  Bot,
  GitCompareArrows,
  Github,
  ShieldCheck,
} from "lucide-react";

import { useScrollReveal } from "@/components/landing/use-scroll-reveal";

const features = [
  {
    icon: Github,
    title: "Connect the repo",
    description:
      "Start from a real GitHub repository and keep every thread grounded in the project branch.",
  },
  {
    icon: ShieldCheck,
    title: "Run in isolation",
    description:
      "Give the agent a Daytona sandbox where it can inspect, edit, test, and recover without touching your machine.",
  },
  {
    icon: Bot,
    title: "Guide the agent",
    description:
      "Use a Codex-backed thread to describe the change, attach context, and follow the work as it happens.",
  },
  {
    icon: GitCompareArrows,
    title: "Review the pull request",
    description:
      "Move from agent work to diff review and PR creation without losing the conversation behind the change.",
  },
] as const;

export function FeaturesGrid() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="support" className="landing-section px-5 py-20 sm:px-8 sm:py-24 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <p className="font-mono text-[10px] font-normal uppercase tracking-[0.22em] text-[color:var(--landing-cyan)]">
          Core workflow
        </p>
        <h2 className="mt-4 max-w-4xl text-balance font-display text-[clamp(2rem,5vw,4.8rem)] font-normal leading-[0.96] tracking-normal text-[color:var(--landing-ink)]">
          The important parts of agent-led pull requests.
        </h2>
        <p className="mt-5 max-w-2xl text-sm leading-relaxed text-[color:var(--landing-muted)] sm:text-base">
          AutoPR keeps the product surface focused: bring a repo, run the agent in a safe workspace, then review and ship the change.
        </p>

        <div
          ref={ref}
          className="mt-12 grid grid-cols-1 border-l border-t border-[color:var(--landing-line)] sm:grid-cols-2 lg:grid-cols-4"
        >
          {features.map((feature, i) => (
            <article
              key={feature.title}
              className={cn(
                "landing-reveal min-h-48 border-b border-r border-[color:var(--landing-line)] bg-[color:var(--landing-panel)] p-5",
                isVisible && "is-visible",
                isVisible && `landing-stagger-${i + 1}`,
              )}
            >
              <div className="flex size-9 items-center justify-center border border-[color:var(--landing-line)] bg-[color:var(--landing-paper)]">
                <feature.icon className="size-4 text-[color:var(--landing-green)]" aria-hidden />
              </div>
              <h3 className="mt-5 text-sm font-normal text-[color:var(--landing-ink)]">
                {feature.title}
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--landing-muted)]">
                {feature.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
