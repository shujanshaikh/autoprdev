import { Button } from "@autopr/ui/components/button";
import { cn } from "@autopr/ui/lib/utils";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";

export function ModeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "relative overflow-hidden text-muted-foreground",
        "hover:bg-muted/60 hover:text-foreground",
        "dark:hover:bg-sidebar-accent",
        className,
      )}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      aria-pressed={isDark}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      suppressHydrationWarning
    >
      <Sun
        className={cn(
          "size-4 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
          isDark ? "-translate-y-1 rotate-45 opacity-0" : "translate-y-0 rotate-0 opacity-100",
        )}
        aria-hidden="true"
      />
      <Moon
        className={cn(
          "absolute size-4 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
          isDark ? "translate-y-0 rotate-0 opacity-100" : "translate-y-1 -rotate-45 opacity-0",
        )}
        aria-hidden="true"
      />
      <span className="sr-only">{isDark ? "Switch to light mode" : "Switch to dark mode"}</span>
    </Button>
  );
}
