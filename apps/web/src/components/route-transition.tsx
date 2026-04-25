"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * RouteTransition wraps children and animates between route changes.
 * Uses a crossfade approach: when the pathname changes, the old content
 * fades out while the new content fades in, preventing layout jumps.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);
  const [phase, setPhase] = useState<"idle" | "entering">("idle");

  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      setPhase("entering");

      // Remove the entering class after animation completes
      const timer = setTimeout(() => {
        setPhase("idle");
      }, 200);

      return () => clearTimeout(timer);
    }
  }, [pathname]);

  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
        phase === "entering" ? "project-route-enter" : ""
      }`}
    >
      {children}
    </div>
  );
}
