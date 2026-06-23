import { createFileRoute } from "@tanstack/react-router";
import { Authenticated, Unauthenticated } from "convex/react";

import { LatestProjectEntry } from "#/components/latest-project-entry";
import { CodexFloating } from "@/components/landing/codex-floating";
import { HeroSection } from "@/components/landing/hero-section";
import { FeaturesGrid } from "@/components/landing/features-grid";
import { WorkflowSection } from "@/components/landing/workflow-section";
import { PricingCallout } from "@/components/landing/pricing-callout";
import { LandingFooter } from "@/components/landing/landing-footer";

export const metadata = {
  title: "AutoPR | Hosted code-agent workspaces",
  description: "Run Codex-backed agents in isolated Daytona sandboxes with GitHub repos, diffs, terminal, desktop preview, demo recording, PRs, and cost tracking.",
};

function LandingHome() {
  return (
    <div id="top" className="landing-page relative flex min-h-0 flex-1 flex-col overflow-x-clip overflow-y-auto">
      <HeroSection />
      <FeaturesGrid />
      <WorkflowSection />
      <PricingCallout />
      <LandingFooter />
      <CodexFloating />
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
    </>
  );
}

export const Route = createFileRoute("/")({ component: Home });
