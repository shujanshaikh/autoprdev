import { Button } from "@autopr/ui/components/button";
import { useAuth } from "@workos/authkit-tanstack-react-start/client";
import { LogOut, UserRound } from "lucide-react";

export function WorkOSUserButton({ className }: { className?: string }) {
  const { signOut, user } = useAuth();
  const initials = user?.firstName?.[0] ?? user?.email?.[0] ?? "U";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      title="Sign out"
      onClick={() => void signOut({ returnTo: "/" })}
    >
      <span className="sr-only">Sign out</span>
      <span className="flex size-7 items-center justify-center rounded-full border border-border bg-background font-mono text-[10px] uppercase">
        {initials ? initials.toUpperCase() : <UserRound className="size-3.5" aria-hidden="true" />}
      </span>
      <LogOut className="hidden size-3.5" aria-hidden="true" />
    </Button>
  );
}
