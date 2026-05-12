"use client";

import { cn } from "@autopr/ui/lib/utils";
import * as React from "react";

import { CodexLogo } from "@/components/icons/codex-logo";

export function CodexFloating() {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const panelId = React.useId();

  return (
    <div
      className="group fixed bottom-6 left-4 z-40 sm:bottom-8 sm:left-6"
      onMouseLeave={() => setMobileOpen(false)}
    >
      <button
        type="button"
        aria-expanded={mobileOpen}
        aria-controls={panelId}
        className="relative flex size-14 cursor-pointer items-center justify-center bg-primary shadow-[0_12px_40px_-8px_rgb(0_0_0/_0.45)] ring-2 ring-primary/25 transition hover:ring-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={() => setMobileOpen((o) => !o)}
      >
        <CodexLogo className="size-7 text-primary-foreground" />
        <span className="sr-only">Codex subscription support: bring your own Codex, no API bills</span>
      </button>

      <div
        id={panelId}
        role="region"
        aria-label="Codex integration"
        className={cn(
          "absolute bottom-[calc(100%+14px)] left-0 w-[min(calc(100vw-2rem),280px)] border border-border/80 bg-background/95 p-4 shadow-2xl backdrop-blur-md transition duration-200 ease-out",
          mobileOpen
            ? "max-md:visible max-md:pointer-events-auto max-md:opacity-100 max-md:translate-y-0"
            : "max-md:invisible max-md:pointer-events-none max-md:opacity-0 max-md:translate-y-1",
          "max-md:z-50 md:invisible md:pointer-events-none md:opacity-0 md:translate-y-1 md:group-hover:visible md:group-hover:pointer-events-auto md:group-hover:opacity-100 md:group-hover:translate-y-0",
        )}
      >
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Works with your existing Codex subscription
        </p>
        <p className="mt-2 text-sm font-semibold text-foreground">Bring your own Codex</p>
        <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
          No API bills from Autopr: we never tax your token usage.
        </p>
      </div>
    </div>
  );
}
