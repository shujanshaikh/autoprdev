import {
  sandboxProviderLabel,
  type SandboxProvider,
} from "@autopr/backend/convex/lib/sandboxProvider";
import { cn } from "@autopr/ui/lib/utils";

import { DaytonaLogo } from "#/components/icons/daytona-logo";
import { E2BLogo } from "#/components/icons/e2b-logo";

export function SandboxProviderLabel({
  provider,
  iconOnly = false,
  className,
}: {
  provider?: SandboxProvider;
  iconOnly?: boolean;
  className?: string;
}) {
  const label = sandboxProviderLabel(provider);

  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1.5", className)}
      role={iconOnly ? "img" : undefined}
      aria-label={iconOnly ? `${label} sandbox` : undefined}
      title={`${label} sandbox`}
    >
      {provider === "e2b"
        ? <E2BLogo className="h-3.5 w-6 shrink-0" />
        : <DaytonaLogo className="size-3.5 shrink-0" />}
      {!iconOnly ? <span>{label}</span> : null}
    </span>
  );
}
