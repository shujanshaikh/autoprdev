"use client";

import { UserButton } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import {
  Home,
  Loader2,
  MessageSquare,
  Search,
  Settings,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from "@autopr/ui/components/sidebar";

import { RouteTransition } from "@/components/route-transition";
import { cn } from "@autopr/ui/lib/utils";


export interface ProjectThread {
  threadId: string;
  title: string;
  isLive?: boolean;
  updatedAt: number;
}


function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}


function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex size-1.5 shrink-0", className)}>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-40" />
      <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
    </span>
  );
}


export function ProjectSidebar({
  projectId,
  repoFullName,
  threads,
  activeThreadId,
}: {
  projectId: string;
  repoFullName?: string;
  threads: ProjectThread[] | undefined;
  activeThreadId?: string;
}) {
  const displayName = repoFullName ?? "autopr";

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="px-3 pt-4 pb-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link href="/dashboard" />}
              tooltip={displayName}
              className="gap-3 group-data-[collapsible=icon]:justify-center"
            >
              <div className="grid size-8 shrink-0 place-items-center bg-sidebar-primary/10 text-[11px] font-bold uppercase tracking-wide text-sidebar-primary">
                {displayName.charAt(0)}
              </div>
              <span className="min-w-0 truncate text-[13px] font-semibold tracking-tight text-sidebar-foreground">
                {displayName}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <div className="px-4 pb-2 group-data-[collapsible=icon]:hidden">
        <button
          type="button"
          className="flex h-9 w-full items-center gap-2.5 bg-sidebar-accent px-3 text-[12px] text-sidebar-foreground/40 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground/60"
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="ml-auto font-mono text-[10px] tracking-wide text-sidebar-foreground/20">⌘K</kbd>
        </button>
      </div>

      <SidebarContent>
        <SidebarGroup className="px-3 py-1">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href="/dashboard" />}
                  tooltip="Dashboard"
                  className="gap-3 group-data-[collapsible=icon]:justify-center"
                >
                  <Home className="size-4 text-sidebar-foreground/50" aria-hidden="true" />
                  <span className="text-sidebar-foreground/80">Dashboard</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href={`/project/${projectId}`} />}
                  tooltip="Threads"
                  className="gap-3 group-data-[collapsible=icon]:justify-center"
                >
                  <MessageSquare className="size-4 text-sidebar-foreground/50" aria-hidden="true" />
                  <span className="text-sidebar-foreground/80">Threads</span>
                </SidebarMenuButton>
                {typeof threads?.length === "number" ? (
                  <SidebarMenuBadge>{threads.length}</SidebarMenuBadge>
                ) : null}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator className="my-1" />

        <SidebarGroup className="group-data-[collapsible=icon]:hidden px-3 py-1">
          <SidebarGroupLabel className="mb-1 flex h-8 items-center justify-between px-2.5">
            <span>Recents</span>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {threads === undefined ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-4 animate-spin text-sidebar-foreground/20" aria-hidden="true" />
                </div>
              ) : threads.length === 0 ? (
                <div className="py-8 text-center text-[12px] text-sidebar-foreground/25">
                  No threads yet
                </div>
              ) : (
                threads.slice(0, 8).map((thread) => {
                  const isActive = thread.threadId === activeThreadId;
                  return (
                    <SidebarMenuItem key={thread.threadId}>
                      <SidebarMenuButton
                        isActive={isActive}
                        render={
                          <Link
                            href={`/project/${projectId}/thread/${thread.threadId}`}
                          />
                        }
                        tooltip={thread.title}
                        className={cn(
                          "h-auto min-h-[48px] flex-col items-start gap-1 py-2.5 pr-3"
                        )}
                      >
                        <div className="flex w-full items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-sidebar-foreground/85">
                            {thread.title}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-sidebar-foreground/30">
                            {relativeTime(thread.updatedAt)}
                          </span>
                        </div>
                        {thread.isLive ? (
                          <div className="flex items-center gap-1.5 pl-0.5">
                            <LiveDot />
                            <span className="text-[10px] font-medium uppercase tracking-wider text-primary/80">live</span>
                          </div>
                        ) : null}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="mt-auto px-3 py-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href={`/project/${projectId}`} />}
              tooltip="Settings"
              className="gap-3 group-data-[collapsible=icon]:justify-center text-sidebar-foreground/50 hover:text-sidebar-foreground/80"
            >
              <Settings className="size-4" aria-hidden="true" />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex h-10 items-center gap-3 px-2.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <UserButton
            appearance={{
              elements: {
                avatarBox: "size-7 rounded-full",
              },
            }}
          />
          <span className="min-w-0 truncate text-[13px] font-medium text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
            Account
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}


export function ProjectShell({
  projectId,
  repoFullName,
  threads,
  activeThreadId,
  children,
}: {
  projectId: string;
  repoFullName?: string;
  threads: ProjectThread[] | undefined;
  activeThreadId?: string;
  children: ReactNode;
}) {
  return (
    <SidebarProvider className="project-shell h-dvh max-h-dvh overflow-hidden">
      <ProjectSidebar
        projectId={projectId}
        repoFullName={repoFullName}
        threads={threads}
        activeThreadId={activeThreadId}
      />
      <SidebarInset>
        <RouteTransition>{children}</RouteTransition>
      </SidebarInset>
    </SidebarProvider>
  );
}


export function AuthGate({ children }: { children: ReactNode }) {
  return (
    <>
      <Authenticated>{children}</Authenticated>

      <Unauthenticated>
        <main className="grid min-h-svh place-items-center px-5">
          <Link href="/dashboard" className="px-4 py-2 text-sm text-foreground/70 hover:text-foreground transition-colors">
            Sign in from dashboard
          </Link>
        </main>
      </Unauthenticated>

      <AuthLoading>
        <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">
          <Loader2 className="mb-2 size-5 animate-spin" aria-hidden="true" />
          Loading
        </div>
      </AuthLoading>
    </>
  );
}
