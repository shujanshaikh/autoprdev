import { useAuth } from "@workos/authkit-tanstack-react-start/client";
import { Bot } from "lucide-react";

import { WorkOSUserButton } from "#/components/auth/workos-user-button";
import { ModeToggle } from "#/components/mode-toggle";
import { Button } from "@autopr/ui/components/button";

interface DashboardHeaderProps {
  projectCount: number;
  isCodexConnected: boolean;
  onConnectCodex: () => void;
}

export function DashboardHeader({
  projectCount,
  isCodexConnected,
  onConnectCodex,
}: DashboardHeaderProps) {
  const { user } = useAuth();
  const name =
    user?.firstName ??
    user?.email?.split("@")[0] ??
    "operator";

  return (
    <header className="mb-5 flex items-center justify-between gap-4 border-b border-border pb-4">
      <div className="flex items-baseline gap-3">
        <span className="inline-block size-1.5 bg-primary" />
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
        <Button
          type="button"
          variant={isCodexConnected ? "secondary" : "outline"}
          size="sm"
          onClick={onConnectCodex}
        >
          <Bot className="size-3.5" />
          Codex
        </Button>
        <ModeToggle />
        <WorkOSUserButton />
      </div>
    </header>
  );
}
