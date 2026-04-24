"use client";

import { api } from "@autopr/backend/convex/_generated/api";
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated, useAction, useConvexAuth, useQuery } from "convex/react";
import { ArrowUpRight, Github, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";

import { ModeToggle } from "@/components/mode-toggle";
import { normalizeGithubUrl } from "@/lib/github-url";

function statusClass(status: "creating" | "ready" | "failed") {
  if (status === "ready") {
    return "border-secondary/25 bg-secondary/8 text-secondary-foreground dark:text-secondary";
  }

  if (status === "failed") {
    return "border-destructive/35 bg-destructive/10 text-destructive";
  }

  return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

export default function Dashboard() {
  const router = useRouter();
  const user = useUser();
  const { isAuthenticated } = useConvexAuth();
  const projects = useQuery(api.projects.list, isAuthenticated ? {} : "skip");
  const ensureProject = useAction(api.projectActions.ensureForGithubRepo);
  const [githubUrl, setGithubUrl] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const normalizedPreview = useMemo(() => {
    try {
      return githubUrl.trim() ? normalizeGithubUrl(githubUrl) : undefined;
    } catch {
      return undefined;
    }
  }, [githubUrl]);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);

    try {
      normalizeGithubUrl(githubUrl);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Enter a valid GitHub URL.");
      return;
    }

    setIsCreating(true);

    try {
      const data = await ensureProject({ githubUrl });

      if (data.error) {
        throw new Error(data.error ?? "Could not create the project sandbox.");
      }

      router.push(`/project/${data.projectId}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create the project sandbox.");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <>
      <Authenticated>
        <div className="relative flex min-h-0 flex-1 flex-col overflow-x-clip text-foreground">
          <div className="border-b border-primary/15 bg-primary/[0.07] px-4 py-2 text-center text-[11px] font-medium tracking-wide text-primary-foreground/90 dark:text-primary-foreground/90">
            Public GitHub repos · persistent Daytona project sandboxes
          </div>

          <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 py-10 sm:px-8 lg:px-12">
            <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border/50 pb-8">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Project console
                </p>
                <h1
                  className="mt-2 text-[clamp(1.45rem,4vw,2.1rem)] font-extrabold uppercase leading-tight tracking-[0.04em]"
                >
                  Create a repo sandbox
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Welcome {user.user?.firstName ?? user.user?.primaryEmailAddress?.emailAddress ?? "there"}. Paste a
                  public repository URL and autopr will reuse the same sandbox for every thread under that project.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <ModeToggle />
                <UserButton />
              </div>
            </header>

            <section className="border border-primary/15 bg-background shadow-[inset_0_1px_0_0_rgba(var(--primary),0.05)]">
              <form onSubmit={createProject} className="grid gap-4 p-4 sm:p-5">
                <label className="grid gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    GitHub repository URL
                  </span>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={githubUrl}
                      onChange={(event) => setGithubUrl(event.target.value)}
                      placeholder="https://github.com/owner/repo"
                      className="min-h-11 flex-1 border border-border bg-muted/25 px-3 font-mono text-sm outline-none transition focus:border-primary/45 focus:ring-2 focus:ring-primary/20"
                      disabled={isCreating}
                    />
                    <button
                      type="submit"
                      disabled={isCreating}
                      className="inline-flex min-h-11 items-center justify-center gap-2 border border-primary/30 bg-primary/10 px-4 text-sm font-semibold text-primary transition hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isCreating ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Github className="size-4" aria-hidden="true" />}
                      Create sandbox
                    </button>
                  </div>
                </label>

                {normalizedPreview ? (
                  <p className="font-mono text-xs text-muted-foreground">
                    {normalizedPreview.repoFullName}
                    {normalizedPreview.repoBranch ? ` · ${normalizedPreview.repoBranch}` : null}
                  </p>
                ) : null}

                {error ? (
                  <div role="alert" className="border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                ) : null}
              </form>
            </section>

            <section className="mt-8">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Recent projects
                </h2>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {projects?.length ?? 0} total
                </span>
              </div>

              <div className="divide-y divide-border border border-border bg-background">
                {projects === undefined ? (
                  <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                    Loading projects
                  </div>
                ) : projects.length === 0 ? (
                  <div className="p-5 text-sm text-muted-foreground">No projects yet.</div>
                ) : (
                  projects.map((project) => (
                    <Link
                      key={project.projectId}
                      href={`/project/${project.projectId}`}
                      className="grid gap-3 p-4 transition hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-mono text-sm font-semibold">{project.repoFullName}</p>
                          <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${statusClass(project.sandboxStatus)}`}>
                            {project.sandboxStatus}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{project.cloneUrl}</p>
                      </div>
                      <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  ))
                )}
              </div>
            </section>
          </main>
        </div>
      </Authenticated>

      <Unauthenticated>
        <main className="grid min-h-svh place-items-center px-5">
          <div className="w-full max-w-sm border border-border bg-background p-5 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Project console
            </p>
            <h1 className="mt-2 text-2xl font-extrabold uppercase tracking-[0.04em]">
              Sign in
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">Create and reopen repo sandboxes from your account.</p>
            <SignInButton>
              <button className="mt-5 inline-flex min-h-10 items-center justify-center border border-primary/30 bg-primary/10 px-4 text-sm font-semibold text-primary">
                Continue
              </button>
            </SignInButton>
          </div>
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
