import { Button } from "@autopr/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@autopr/ui/components/dropdown-menu";
import { useAuth } from "@workos/authkit-tanstack-react-start/client";
import { LogOut, UserRound } from "lucide-react";
import { useState } from "react";

export function WorkOSUserButton({ className }: { className?: string }) {
  const { signOut, user } = useAuth();
  const [failedProfilePictureUrl, setFailedProfilePictureUrl] = useState<string | undefined>();
  const initials = user?.firstName?.[0] ?? user?.email?.[0] ?? "U";
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  const profilePictureUrl = user?.profilePictureUrl;
  const showProfileImage = Boolean(profilePictureUrl && failedProfilePictureUrl !== profilePictureUrl);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className={className} />}>
        <span className="sr-only">Open user menu</span>
        {profilePictureUrl && showProfileImage ? (
          <img
            src={profilePictureUrl}
            alt={displayName || user?.email || "User profile"}
            className="size-7 rounded-full border border-border object-cover"
            referrerPolicy="no-referrer"
            onError={() => setFailedProfilePictureUrl(profilePictureUrl)}
          />
        ) : (
          <span className="flex size-7 items-center justify-center rounded-full border border-border bg-background font-mono text-[10px] uppercase">
            {initials ? initials.toUpperCase() : <UserRound className="size-3.5" aria-hidden="true" />}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="space-y-1">
            <span className="block font-medium text-foreground">{displayName || "Account"}</span>
            {user?.email ? <span className="block truncate text-muted-foreground">{user.email}</span> : null}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => void signOut({ returnTo: "/" })}>
          <LogOut className="size-3.5" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
