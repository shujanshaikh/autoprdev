"use client";

import { UserButton, useUser } from "@clerk/nextjs";

import { ModeToggle } from "@/components/mode-toggle";

interface DashboardHeaderProps {
  projectCount: number;
}

export function DashboardHeader({ projectCount }: DashboardHeaderProps) {
  const user = useUser();
  const name =
    user.user?.firstName ??
    user.user?.primaryEmailAddress?.emailAddress?.split("@")[0] ??
    "operator";

  return (
    <header className="mb-5 flex items-center justify-between gap-4 border-b border-border pb-4">
      <div className="flex items-baseline gap-3">
        <span className="inline-block size-1.5 bg-foreground" />
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          autopr / dashboard
        </span>
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground/60 sm:inline">
          · {name.toLowerCase()}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground sm:inline">
          {String(projectCount).padStart(2, "0")} projects
        </span>
        <ModeToggle />
        <UserButton />
      </div>
    </header>
  );
}
