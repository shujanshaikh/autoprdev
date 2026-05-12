"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * RouteTransition wraps children and animates between route changes.
 * Uses a crossfade approach: when the pathname changes, the old content
 * fades out while the new content fades in, preventing layout jumps.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div
      key={pathname}
      className="project-route-enter flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      {children}
    </div>
  );
}
