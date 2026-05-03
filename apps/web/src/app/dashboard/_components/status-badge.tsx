"use client";

import { cn } from "@autopr/ui/lib/utils";
import { statusStyles, type SandboxStatus } from "./types";

export function StatusBadge({ status, className }: { status: SandboxStatus; className?: string }) {
  const styles = statusStyles(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
        styles.badge,
        className
      )}
    >
      <span className={cn("size-1.5 rounded-full", styles.dot)} />
      {status}
    </span>
  );
}

export function StatusDot({ status, className }: { status: SandboxStatus; className?: string }) {
  const styles = statusStyles(status);
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className={cn("relative flex size-2")}>
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-30",
            styles.dot
          )}
        />
        <span className={cn("relative inline-flex size-2 rounded-full", styles.dot)} />
      </span>
    </span>
  );
}
