import { createFileRoute } from "@tanstack/react-router";

import { LandingPage } from "@/components/landing/landing-page";

export const metadata = {
  title: "AutoPR | Your autonomous code companion",
  description:
    "AutoPR reviews, refactors, and ships pull requests so your team stays in flow while focused agents handle the busywork.",
};

function LandingHome() {
  return <LandingPage />;
}

function Home() {
  return <LandingHome />;
}

export const Route = createFileRoute("/")({ component: Home });
