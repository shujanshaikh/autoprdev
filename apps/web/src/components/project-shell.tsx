"use client";

import { UserButton } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import {
  ArrowLeft,
  Home,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  Search,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/* ─── types ───────────────────────────────────────────────────────── */

export interface ProjectThread {
  threadId: string;
  title: string;
  isLive?: boolean;
  updatedAt: number;
}

/* ─── Sidebar ─────────────────────────────────────────────────────── */

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
    <aside className="hidden w-[250px] shrink-0 border-r border-border/70 bg-muted/20 lg:flex lg:flex-col">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
          <div className="grid size-6 shrink-0 place-items-center border border-primary/25 bg-primary/10 text-[10px] font-black text-primary">
            A
          </div>
          <span className="truncate font-mono text-xs font-semibold text-foreground/90">
            {repoFullName ?? "autopr"}
          </span>
        </Link>
        <MoreHorizontal className="ml-auto size-4 text-muted-foreground" aria-hidden="true" />
      </div>

      {/* Search */}
      <div className="p-3">
        <label className="flex h-9 items-center gap-2 border border-border bg-background/70 px-2 text-xs text-muted-foreground">
          <Search className="size-3.5" aria-hidden="true" />
          <span>Search</span>
          <span className="ml-auto font-mono text-[10px]">Cmd K</span>
        </label>
      </div>

      {/* Nav */}
      <nav className="grid gap-1 px-2 text-sm">
        <Link
          href="/dashboard"
          className="flex h-9 items-center gap-2 px-2 text-muted-foreground transition hover:bg-muted/45 hover:text-foreground"
        >
          <Home className="size-4" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">Dashboard</span>
        </Link>
        <Link
          href={`/project/${projectId}`}
          className="flex h-9 items-center gap-2 px-2 text-muted-foreground transition hover:bg-muted/45 hover:text-foreground"
        >
          <MessageSquare className="size-4" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">Threads</span>
          {typeof threads?.length === "number" ? (
            <span className="font-mono text-xs">{threads.length}</span>
          ) : null}
        </Link>
      </nav>

      {/* Recents */}
      <div className="mt-6 min-h-0 flex-1 overflow-hidden px-2">
        <div className="mb-2 flex items-center justify-between px-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Recents
          </p>
          <PanelLeft className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </div>

        <div className="grid gap-1 overflow-y-auto pr-1">
          {threads === undefined ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">Loading threads</div>
          ) : threads.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">No threads yet.</div>
          ) : (
            threads.slice(0, 8).map((recentThread) => (
              <Link
                key={recentThread.threadId}
                href={`/project/${projectId}/thread/${recentThread.threadId}`}
                className={`group border px-2 py-2 transition ${
                  recentThread.threadId === activeThreadId
                    ? "border-primary/20 bg-primary/8 text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/35 hover:text-foreground"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                    {recentThread.title}
                  </span>
                  {recentThread.isLive ? (
                    <span className="size-1.5 shrink-0 bg-primary shadow-[0_0_0_3px_rgba(var(--primary),0.18)]" />
                  ) : null}
                </div>
                <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                  {new Date(recentThread.updatedAt).toLocaleDateString()}
                </p>
              </Link>
            ))
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto flex shrink-0 items-center justify-between border-t border-border/70 p-3">
        <Link
          href={`/project/${projectId}`}
          className="inline-flex items-center gap-2 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Project
        </Link>
        <UserButton />
      </div>
    </aside>
  );
}

/* ─── Project Shell ───────────────────────────────────────────────── */

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
    <div className="relative flex h-dvh max-h-dvh overflow-hidden bg-background text-foreground">
      <ProjectSidebar
        projectId={projectId}
        repoFullName={repoFullName}
        threads={threads}
        activeThreadId={activeThreadId}
      />
      {children}
    </div>
  );
}

/* ─── Auth gates ──────────────────────────────────────────────────── */

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
