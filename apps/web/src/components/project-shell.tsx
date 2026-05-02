"use client";

import { UserButton } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import {
  ArrowLeft,
  Home,
  Loader2,
  MessageSquare,
  MoreHorizontal,
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
} from "@autopr/ui/components/sidebar";

import { RouteTransition } from "@/components/route-transition";


export interface ProjectThread {
  threadId: string;
  title: string;
  isLive?: boolean;
  updatedAt: number;
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
  return (
    <Sidebar collapsible="icon" variant="sidebar">
      {/* Header */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link href="/dashboard" />}
              tooltip={repoFullName ?? "autopr"}
            >
              <div className="grid size-6 shrink-0 place-items-center border border-sidebar-primary/25 bg-sidebar-primary/10 text-[10px] font-black text-sidebar-primary">
                A
              </div>
              <span className="truncate font-mono text-xs font-semibold">
                {repoFullName ?? "autopr"}
              </span>
              <MoreHorizontal className="ml-auto size-4 text-sidebar-foreground/50" aria-hidden="true" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href="/dashboard" />}
                  tooltip="Dashboard"
                >
                  <Home className="size-4" aria-hidden="true" />
                  <span>Dashboard</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href={`/project/${projectId}`} />}
                  tooltip="Threads"
                >
                  <MessageSquare className="size-4" aria-hidden="true" />
                  <span>Threads</span>
                </SidebarMenuButton>
                {typeof threads?.length === "number" ? (
                  <SidebarMenuBadge>{threads.length}</SidebarMenuBadge>
                ) : null}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Recents</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {threads === undefined ? (
                <div className="px-2 py-3 text-xs text-sidebar-foreground/50">
                  Loading threads
                </div>
              ) : threads.length === 0 ? (
                <div className="px-2 py-3 text-xs text-sidebar-foreground/50">
                  No threads yet.
                </div>
              ) : (
                threads.slice(0, 8).map((recentThread) => (
                  <SidebarMenuItem key={recentThread.threadId}>
                    <SidebarMenuButton
                      isActive={recentThread.threadId === activeThreadId}
                      render={
                        <Link
                          href={`/project/${projectId}/thread/${recentThread.threadId}`}
                        />
                      }
                      tooltip={recentThread.title}
                    >
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                        {recentThread.title}
                      </span>
                      {recentThread.isLive ? (
                        <span className="size-1.5 shrink-0 bg-sidebar-primary shadow-[0_0_0_3px_oklch(0.90_0.15_115.6_/_0.18)]" />
                      ) : null}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center justify-between group-data-[collapsible=icon]:justify-center">
          <Link
            href={`/project/${projectId}`}
            className="inline-flex items-center gap-2 text-xs text-sidebar-foreground/70 transition hover:text-sidebar-foreground group-data-[collapsible=icon]:hidden"
          >
            <ArrowLeft className="size-3.5 shrink-0" aria-hidden="true" />
            <span>Project</span>
          </Link>
          <UserButton />
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
          <Link href="/dashboard" className="border border-border px-4 py-2 text-sm">
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
