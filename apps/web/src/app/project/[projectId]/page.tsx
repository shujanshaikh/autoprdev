"use client";

import { api } from "@autopr/backend/convex/_generated/api";
import type { Id } from "@autopr/backend/convex/_generated/dataModel";
import { UserButton } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated, useConvexAuth, useMutation, useQuery } from "convex/react";
import { ArrowLeft, ArrowRight, Loader2, MessageSquarePlus } from "lucide-react";
import Link from "next/link";
import { Syne } from "next/font/google";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { ModeToggle } from "@/components/mode-toggle";

const display = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
});

function statusClass(status: "creating" | "ready" | "failed") {
  if (status === "ready") {
    return "border-teal-500/25 bg-teal-500/8 text-teal-700 dark:text-teal-300";
  }

  if (status === "failed") {
    return "border-destructive/35 bg-destructive/10 text-destructive";
  }

  return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

export default function ProjectOverviewPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const projectId = params.projectId as Id<"projects">;
  const project = useQuery(api.projects.get, isAuthenticated ? { projectId } : "skip");
  const threads = useQuery(api.threads.listByProject, isAuthenticated ? { projectId } : "skip");
  const createThread = useMutation(api.threads.create);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function startThread() {
    if (!project || project.sandboxStatus !== "ready") {
      return;
    }

    setIsCreatingThread(true);
    setError(undefined);

    try {
      const threadId = await createThread({ projectId, title: "New thread" });
      router.push(`/project/${projectId}/thread/${threadId}`);
    } catch (threadError) {
      setError(threadError instanceof Error ? threadError.message : "Could not create a thread.");
    } finally {
      setIsCreatingThread(false);
    }
  }

  return (
    <>
      <Authenticated>
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 py-10 sm:px-8 lg:px-12">
          <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border/50 pb-8">
            <div>
              <Link
                href="/dashboard"
                className="mb-4 inline-flex items-center gap-2 text-xs text-muted-foreground transition hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                Dashboard
              </Link>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Project
              </p>
              <h1
                className={`${display.className} mt-2 text-[clamp(1.35rem,4vw,2rem)] font-extrabold uppercase leading-tight tracking-[0.04em]`}
              >
                {project?.repoFullName ?? "Loading project"}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <ModeToggle />
              <UserButton />
            </div>
          </header>

          {project === undefined || threads === undefined ? (
            <div className="grid min-h-56 place-items-center border border-border text-sm text-muted-foreground">
              <Loader2 className="mb-2 size-5 animate-spin" aria-hidden="true" />
              Loading project
            </div>
          ) : !project ? (
            <div className="border border-border p-5 text-sm text-muted-foreground">Project not found.</div>
          ) : (
            <>
              <section className="grid gap-4 border border-teal-500/15 bg-background p-4 sm:grid-cols-2 sm:p-5">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Repository
                  </p>
                  <p className="mt-2 break-all font-mono text-sm">{project.cloneUrl}</p>
                  {project.repoBranch ? (
                    <p className="mt-1 font-mono text-xs text-muted-foreground">branch {project.repoBranch}</p>
                  ) : null}
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Sandbox
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${statusClass(project.sandboxStatus)}`}>
                      {project.sandboxStatus}
                    </span>
                    {project.sandboxId ? (
                      <span className="truncate font-mono text-xs text-muted-foreground">{project.sandboxId}</span>
                    ) : null}
                  </div>
                  {project.sandboxWorkDir ? (
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{project.sandboxWorkDir}</p>
                  ) : null}
                </div>
              </section>

              {project.sandboxStatus === "creating" ? (
                <div className="mt-4 border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
                  Creating the Daytona sandbox and cloning the repository. Threads unlock when the sandbox is ready.
                </div>
              ) : null}

              {project.sandboxStatus === "failed" ? (
                <div className="mt-4 border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive">
                  <p>{project.sandboxError ?? "Sandbox creation failed."}</p>
                  <Link href="/dashboard" className="mt-3 inline-flex text-foreground underline underline-offset-4">
                    Back to dashboard
                  </Link>
                </div>
              ) : null}

              <section className="mt-8">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Threads
                  </h2>
                  <button
                    type="button"
                    onClick={() => void startThread()}
                    disabled={project.sandboxStatus !== "ready" || isCreatingThread}
                    className="inline-flex min-h-10 items-center justify-center gap-2 border border-teal-500/30 bg-teal-500/10 px-3 text-sm font-semibold text-teal-800 transition hover:bg-teal-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-teal-200"
                  >
                    {isCreatingThread ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <MessageSquarePlus className="size-4" aria-hidden="true" />}
                    New thread
                  </button>
                </div>

                {error ? (
                  <div className="mb-3 border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                ) : null}

                <div className="divide-y divide-border border border-border bg-background">
                  {threads.length === 0 ? (
                    <div className="p-5 text-sm text-muted-foreground">No threads yet.</div>
                  ) : (
                    threads.map((thread) => (
                      <Link
                        key={thread._id}
                        href={`/project/${projectId}/thread/${thread._id}`}
                        className="grid gap-2 p-4 transition hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30 sm:grid-cols-[1fr_auto] sm:items-center"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-mono text-sm font-semibold">{thread.title}</p>
                            {thread.isLive ? (
                              <span className="border border-teal-500/25 bg-teal-500/8 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-teal-700 dark:text-teal-300">
                                live
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 font-mono text-xs text-muted-foreground">
                            updated {new Date(thread.updatedAt).toLocaleString()}
                          </p>
                        </div>
                        <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
                      </Link>
                    ))
                  )}
                </div>
              </section>
            </>
          )}
        </main>
      </Authenticated>

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
