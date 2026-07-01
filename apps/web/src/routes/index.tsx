import { createFileRoute } from "@tanstack/react-router";

import { RouteTransition } from "#/components/route-transition";
import { FigmaLandingPage } from "@/components/landing/figma-landing-page";

export const metadata = {
  title: "AutoPR | Your autonomous code companion",
  description:
    "AutoPR reviews, refactors, and ships pull requests so your team stays in flow while focused agents handle the busywork.",
};

function LandingHome() {
  return <FigmaLandingPage />;
}

function Home() {
  return (
    <RouteTransition>
      <LandingHome />
    </RouteTransition>
  );
}

export const Route = createFileRoute("/")({ component: Home });
