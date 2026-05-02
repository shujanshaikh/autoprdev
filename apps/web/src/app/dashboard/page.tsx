"use client";

import { api } from "@autopr/backend/convex/_generated/api";
import { Button } from "@autopr/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@autopr/ui/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@autopr/ui/components/select";
import { SignInButton, UserButton, useReverification, useUser } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated, useConvexAuth, useMutation, useQuery } from "convex/react";
import { ArrowUpRight, GitBranch, Github, Loader2, Lock, RefreshCw, Trash2, Unlock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ModeToggle } from "@/components/mode-toggle";

type GithubRepository = {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  updatedAt?: string;
};

type GithubBranch = {
  name: string;
  sha: string;
  protected: boolean;
};

function statusClass(status: "creating" | "ready" | "failed") {
  if (status === "ready") {
    return "border-secondary/25 bg-secondary/8 text-secondary-foreground dark:text-secondary";
  }

  if (status === "failed") {
    return "border-destructive/35 bg-destructive/10 text-destructive";
  }

  return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data && typeof data === "object" && "error" in data ? String(data.error) : "Request failed.";
    throw new Error(error);
  }
  return data as T;
}

export default function Dashboard() {
  const router = useRouter();
  const user = useUser();
  const createExternalAccount = useReverification((params: { strategy: "oauth_github"; redirectUrl: string }) =>
    user.user?.createExternalAccount(params),
  );
  const { isAuthenticated } = useConvexAuth();
  const projects = useQuery(api.projects.list, isAuthenticated ? {} : "skip");
  const removeProject = useMutation(api.projects.remove);
  const [repositories, setRepositories] = useState<GithubRepository[]>([]);
  const [branches, setBranches] = useState<GithubBranch[]>([]);
  const [selectedRepoFullName, setSelectedRepoFullName] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [repoSearch, setRepoSearch] = useState("");
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isConnectingGithub, setIsConnectingGithub] = useState(false);
  const [isGithubConnected, setIsGithubConnected] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [projectIdToDelete, setProjectIdToDelete] = useState<string | undefined>();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const selectedRepo = useMemo(
    () => repositories.find((repository) => repository.fullName === selectedRepoFullName),
    [repositories, selectedRepoFullName],
  );

  const filteredRepositories = useMemo(() => {
    const search = repoSearch.trim().toLowerCase();
    if (!search) return repositories;
    return repositories.filter((repository) => repository.fullName.toLowerCase().includes(search));
  }, [repoSearch, repositories]);

  const projectToDelete = useMemo(
    () => projects?.find((project) => project.projectId === projectIdToDelete),
    [projectIdToDelete, projects],
  );

  const loadRepositories = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsLoadingRepos(true);
    setError(undefined);

    try {
      const data = await readJson<{ repositories: GithubRepository[] }>(await fetch("/api/github/repositories"));
      setRepositories(data.repositories);
      setIsGithubConnected(true);

      if (!selectedRepoFullName && data.repositories[0]) {
        setSelectedRepoFullName(data.repositories[0].fullName);
      }
    } catch (requestError) {
      setRepositories([]);
      setIsGithubConnected(false);
      setError(requestError instanceof Error ? requestError.message : "Could not load GitHub repositories.");
    } finally {
      setIsLoadingRepos(false);
    }
  }, [isAuthenticated, selectedRepoFullName]);

  useEffect(() => {
    void loadRepositories();
  }, [loadRepositories]);

  useEffect(() => {
    if (!selectedRepo) {
      setBranches([]);
      setSelectedBranch("");
      return;
    }

    let active = true;
    setIsLoadingBranches(true);
    setError(undefined);

    fetch(`/api/github/repositories/${encodeURIComponent(selectedRepo.owner)}/${encodeURIComponent(selectedRepo.name)}/branches`)
      .then((response) => readJson<{ branches: GithubBranch[] }>(response))
      .then((data) => {
        if (!active) return;
        setBranches(data.branches);
        setSelectedBranch(
          data.branches.some((branch) => branch.name === selectedRepo.defaultBranch)
            ? selectedRepo.defaultBranch
            : data.branches[0]?.name ?? "",
        );
      })
      .catch((requestError) => {
        if (!active) return;
        setBranches([]);
        setSelectedBranch("");
        setError(requestError instanceof Error ? requestError.message : "Could not load branches.");
      })
      .finally(() => {
        if (active) setIsLoadingBranches(false);
      });

    return () => {
      active = false;
    };
  }, [selectedRepo]);

  async function connectGithub() {
    setIsConnectingGithub(true);
    setError(undefined);

    try {
      if (!user.user) {
        throw new Error("GitHub account linking is not available in this Clerk session.");
      }

      const externalAccount = await createExternalAccount({
        strategy: "oauth_github",
        redirectUrl: window.location.href,
      });
      const redirectUrl = externalAccount?.verification?.externalVerificationRedirectURL?.href;

      if (redirectUrl) {
        window.location.assign(redirectUrl);
        return;
      }

      await user.user.reload();
      await loadRepositories();
      setIsConnectingGithub(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not connect GitHub.");
      setIsConnectingGithub(false);
    }
  }

  async function createProject() {
    if (!selectedRepo || !selectedBranch) {
      setError("Select a GitHub repository and branch.");
      return;
    }

    setIsCreating(true);
    setError(undefined);

    try {
      const data = await readJson<{ projectId: string; error?: string }>(
        await fetch("/api/projects/from-github", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repository: {
              id: selectedRepo.id,
              fullName: selectedRepo.fullName,
              owner: selectedRepo.owner,
              name: selectedRepo.name,
              htmlUrl: selectedRepo.htmlUrl,
              cloneUrl: selectedRepo.cloneUrl,
              defaultBranch: selectedRepo.defaultBranch,
            },
            branch: selectedBranch,
          }),
        }),
      );

      router.push(`/project/${data.projectId}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create the project sandbox.");
    } finally {
      setIsCreating(false);
    }
  }

  async function deleteProject() {
    if (!projectToDelete) return;

    setIsDeleting(true);
    setError(undefined);

    try {
      await removeProject({ projectId: projectToDelete.projectId });
      setProjectIdToDelete(undefined);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not delete the project.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <Authenticated>
        <div className="relative flex min-h-0 flex-1 flex-col overflow-x-clip text-foreground">
          <div className="border-b border-primary/15 bg-primary/[0.07] px-4 py-2 text-center text-[11px] font-medium tracking-wide text-primary-foreground/90 dark:text-primary-foreground/90">
            Connected GitHub repos - persistent Daytona project sandboxes
          </div>

          <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 py-10 sm:px-8 lg:px-12">
            <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border/50 pb-8">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Project console
                </p>
                <h1 className="mt-2 text-[clamp(1.45rem,4vw,2.1rem)] font-extrabold uppercase leading-tight tracking-[0.04em]">
                  Create a repo sandbox
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Welcome {user.user?.firstName ?? user.user?.primaryEmailAddress?.emailAddress ?? "there"}. Connect
                  GitHub, choose a repository, and autopr will keep that project in a reusable Daytona sandbox.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <ModeToggle />
                <UserButton />
              </div>
            </header>

            <section className="border border-primary/15 bg-background shadow-[inset_0_1px_0_0_rgba(var(--primary),0.05)]">
              <div className="grid gap-4 p-4 sm:p-5">
                {!isGithubConnected ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        GitHub connection
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Connect GitHub to load your public and private repositories.
                      </p>
                    </div>
                    <Button type="button" disabled={isConnectingGithub} onClick={connectGithub}>
                      {isConnectingGithub ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Github className="size-4" aria-hidden="true" />}
                      Connect GitHub
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto] lg:items-end">
                      <label className="grid gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          GitHub repository
                        </span>
                        <div className="grid gap-2">
                          <input
                            value={repoSearch}
                            onChange={(event) => setRepoSearch(event.target.value)}
                            placeholder="Search repositories"
                            className="min-h-9 border border-border bg-muted/25 px-3 font-mono text-xs outline-none transition focus:border-primary/45 focus:ring-2 focus:ring-primary/20"
                            disabled={isLoadingRepos || isCreating}
                          />
                          <Select value={selectedRepoFullName} onValueChange={(value) => value && setSelectedRepoFullName(value)}>
                            <SelectTrigger className="h-11 w-full justify-between" disabled={isLoadingRepos || isCreating}>
                              <SelectValue placeholder={isLoadingRepos ? "Loading repositories..." : "Select repository"} />
                            </SelectTrigger>
                            <SelectContent align="start" className="max-h-80">
                              {filteredRepositories.map((repository) => (
                                <SelectItem key={repository.id} value={repository.fullName}>
                                  <span className="flex min-w-0 items-center gap-2">
                                    {repository.private ? <Lock className="size-3.5" aria-hidden="true" /> : <Unlock className="size-3.5" aria-hidden="true" />}
                                    <span className="truncate font-mono">{repository.fullName}</span>
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </label>

                      <label className="grid gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          Branch
                        </span>
                        <Select value={selectedBranch} onValueChange={(value) => value && setSelectedBranch(value)}>
                          <SelectTrigger className="h-11 w-full justify-between" disabled={!selectedRepo || isLoadingBranches || isCreating}>
                            <SelectValue placeholder={isLoadingBranches ? "Loading..." : "Select branch"} />
                          </SelectTrigger>
                          <SelectContent align="start" className="max-h-80">
                            {branches.map((branch) => (
                              <SelectItem key={branch.sha} value={branch.name}>
                                <span className="flex min-w-0 items-center gap-2">
                                  <GitBranch className="size-3.5" aria-hidden="true" />
                                  <span className="truncate font-mono">{branch.name}</span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>

                      <button
                        type="button"
                        disabled={!selectedRepo || !selectedBranch || isCreating || isLoadingBranches}
                        onClick={() => void createProject()}
                        className="inline-flex min-h-11 items-center justify-center gap-2 border border-primary/30 bg-primary/10 px-4 text-sm font-semibold text-primary transition hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isCreating ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Github className="size-4" aria-hidden="true" />}
                        Create sandbox
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => void loadRepositories()}
                        disabled={isLoadingRepos || isCreating}
                        className="inline-flex items-center gap-1.5 text-primary transition hover:text-primary/80 disabled:opacity-50"
                      >
                        <RefreshCw className={`size-3 ${isLoadingRepos ? "animate-spin" : ""}`} aria-hidden="true" />
                        Refresh repos
                      </button>
                      {selectedRepo ? (
                        <span>
                          {selectedRepo.private ? "Private" : "Public"} - default {selectedRepo.defaultBranch}
                        </span>
                      ) : null}
                    </div>
                  </>
                )}

                {error ? (
                  <div role="alert" className="border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                ) : null}
              </div>
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
                    <div
                      key={project.projectId}
                      className="grid gap-3 p-4 transition hover:bg-muted/35 sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <Link
                        href={`/project/${project.projectId}`}
                        className="min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-mono text-sm font-semibold">{project.repoFullName}</p>
                          <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${statusClass(project.sandboxStatus)}`}>
                            {project.sandboxStatus}
                          </span>
                          <span className="inline-flex items-center gap-1 border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                            <GitBranch className="size-3" aria-hidden="true" />
                            {project.currentBranch ?? project.repoBranch ?? project.defaultBranch ?? "main"}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{project.cloneUrl}</p>
                      </Link>
                      <div className="flex items-center gap-2 sm:justify-end">
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon-sm"
                          aria-label={`Delete ${project.repoFullName}`}
                          onClick={() => setProjectIdToDelete(project.projectId)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                        <Link
                          href={`/project/${project.projectId}`}
                          className="inline-flex size-7 items-center justify-center text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                          aria-label={`Open ${project.repoFullName}`}
                        >
                          <ArrowUpRight className="size-4" aria-hidden="true" />
                        </Link>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </main>

          <Dialog open={Boolean(projectToDelete)} onOpenChange={(open) => !open && setProjectIdToDelete(undefined)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete project?</DialogTitle>
                <DialogDescription>
                  This will delete {projectToDelete?.repoFullName ?? "this project"} and all of its threads and
                  messages. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" disabled={isDeleting} />}>Cancel</DialogClose>
                <Button type="button" variant="destructive" disabled={isDeleting} onClick={deleteProject}>
                  {isDeleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
                  Delete project
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
