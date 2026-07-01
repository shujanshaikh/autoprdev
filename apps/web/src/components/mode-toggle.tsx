import { Button } from "@autopr/ui/components/button";
import { cn } from "@autopr/ui/lib/utils";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ModeToggle({
  className,
  presentation = "icon",
}: {
  className?: string;
  presentation?: "icon" | "switch";
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  if (presentation === "switch") {
    return (
      <Button
        type="button"
        variant="ghost"
        className={cn(
          "group relative h-8 w-16 shrink-0 overflow-hidden rounded-full border px-1",
          "border-border bg-secondary text-foreground shadow-none",
          "transition-[background-color,border-color] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
          "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none",
          className,
        )}
        aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
        aria-pressed={isDark}
        onClick={() => setTheme(isDark ? "light" : "dark")}
        suppressHydrationWarning
      >
        <span
          className={cn(
            "absolute inset-y-1 left-1 z-10 grid aspect-square place-items-center rounded-full",
            "border border-border bg-primary text-primary-foreground shadow-none",
            "transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
            isDark ? "translate-x-8" : "translate-x-0",
          )}
          aria-hidden="true"
        >
          {isDark ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
        </span>
        <span className="absolute inset-0 bg-muted/50" />
        <Sun
          className={cn(
            "absolute left-2.5 size-3.5 transition-[opacity,transform] duration-300 motion-reduce:transition-none",
            isDark ? "scale-75 opacity-35" : "scale-100 opacity-0",
          )}
          aria-hidden="true"
        />
        <Moon
          className={cn(
            "absolute right-2.5 size-3.5 transition-[opacity,transform] duration-300 motion-reduce:transition-none",
            isDark ? "scale-100 opacity-0" : "scale-75 opacity-35",
          )}
          aria-hidden="true"
        />
        <span className="sr-only">{isDark ? "Switch to light mode" : "Switch to dark mode"}</span>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "relative overflow-hidden text-muted-foreground",
        "hover:bg-secondary hover:text-foreground",
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
