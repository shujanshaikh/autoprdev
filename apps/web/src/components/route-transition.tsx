import { useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = useLocation({ select: (location) => location.pathname });

  return (
    <div
      key={pathname}
      className="project-route-enter flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      {children}
    </div>
  );
}
