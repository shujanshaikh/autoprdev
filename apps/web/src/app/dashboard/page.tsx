"use client";

import { api } from "@autopr/backend/convex/_generated/api";
import { SignInButton, useReverification, useUser } from "@clerk/nextjs";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useConvexAuth,
  useMutation,
  useQuery,
} from "convex/react";
import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CreateSandboxPanel } from "./_components/create-sandbox-panel";
import { DashboardHeader } from "./_components/dashboard-header";
import { DeleteDialog } from "./_components/delete-dialog";
import { ProjectGrid } from "./_components/project-grid";
import { readJson, type GithubBranch, type GithubRepository } from "./_components/types";

export default function Dashboard() {
  const router = useRouter();
  const user = useUser();
  const createExternalAccount = useReverification(
    (params: { strategy: "oauth_github"; redirectUrl: string }) =>
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
    () => repositories.find((r) => r.fullName === selectedRepoFullName),
    [repositories, selectedRepoFullName],
  );

  const filteredRepositories = useMemo(() => {
    const search = repoSearch.trim().toLowerCase();
    if (!search) return repositories;
    return repositories.filter((r) => r.fullName.toLowerCase().includes(search));
  }, [repoSearch, repositories]);

  const projectToDelete = useMemo(
    () => projects?.find((p) => p.projectId === projectIdToDelete),
    [projectIdToDelete, projects],
  );

  const loadRepositories = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsLoadingRepos(true);
    setError(undefined);

    try {
      const data = await readJson<{ repositories: GithubRepository[] }>(
        await fetch("/api/github/repositories"),
      );
      setRepositories(data.repositories);
      setIsGithubConnected(true);

      if (!selectedRepoFullName && data.repositories[0]) {
        setSelectedRepoFullName(data.repositories[0].fullName);
      }
    } catch (err) {
      setRepositories([]);
      setIsGithubConnected(false);
      setError(err instanceof Error ? err.message : "Could not load GitHub repositories.");
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

    fetch(
      `/api/github/repositories/${encodeURIComponent(selectedRepo.owner)}/${encodeURIComponent(selectedRepo.name)}/branches`,
    )
      .then((res) => readJson<{ branches: GithubBranch[] }>(res))
      .then((data) => {
        if (!active) return;
        setBranches(data.branches);
        setSelectedBranch(
          data.branches.some((b) => b.name === selectedRepo.defaultBranch)
            ? selectedRepo.defaultBranch
            : data.branches[0]?.name ?? "",
        );
      })
      .catch((err) => {
        if (!active) return;
        setBranches([]);
        setSelectedBranch("");
        setError(err instanceof Error ? err.message : "Could not load branches.");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect GitHub.");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the project sandbox.");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the project.");
    } finally {
      setIsDeleting(false);
    }
  }

  const projectCount = projects?.length ?? 0;

  return (
    <>
      <Authenticated>
        <div className="dashboard-shell relative flex h-svh min-h-0 flex-1 flex-col overflow-hidden text-foreground">
          <main className="mx-auto flex h-full w-full max-w-6xl flex-1 flex-col px-5 pt-5 pb-5 sm:px-8 lg:px-10">
            <DashboardHeader projectCount={projectCount} />

            <div className="flex min-h-0 flex-1 flex-col gap-5">
              <div className="flex shrink-0 flex-col">
            <CreateSandboxPanel
              isGithubConnected={isGithubConnected}
              isConnectingGithub={isConnectingGithub}
              isLoadingRepos={isLoadingRepos}
              isLoadingBranches={isLoadingBranches}
              isCreating={isCreating}
              repositories={repositories}
              filteredRepositories={filteredRepositories}
              branches={branches}
              selectedRepoFullName={selectedRepoFullName}
              selectedBranch={selectedBranch}
              repoSearch={repoSearch}
              selectedRepo={selectedRepo}
              error={error}
              onConnectGithub={connectGithub}
              onRefreshRepos={loadRepositories}
              onRepoSearchChange={setRepoSearch}
              onRepoChange={setSelectedRepoFullName}
              onBranchChange={setSelectedBranch}
              onCreate={createProject}
            />
              </div>

              <section className="flex min-h-0 flex-1 flex-col">
                <div className="mb-2 flex items-end justify-between gap-4">
                  <h2 className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                    Recent sandboxes
                  </h2>
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70">
                    {String(projectCount).padStart(2, "0")} total
                  </span>
                </div>

                <div className="minimal-scrollbar min-h-0 flex-1 overflow-y-auto">
                  <ProjectGrid
                    projects={projects}
                    onDelete={(id) => setProjectIdToDelete(id)}
                  />
                </div>
              </section>
            </div>
          </main>

          <DeleteDialog
            open={Boolean(projectToDelete)}
            onOpenChange={(open) => !open && setProjectIdToDelete(undefined)}
            projectName={projectToDelete?.repoFullName ?? "this project"}
            isDeleting={isDeleting}
            onDelete={deleteProject}
          />
        </div>
      </Authenticated>

      <Unauthenticated>
        <main className="grid min-h-svh place-items-center px-5">
          <div className="w-full max-w-md border border-border bg-card">
            <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-3 font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
              <span className="flex items-center gap-2">
                <span className="size-1.5 bg-foreground" />
                autopr
              </span>
              <span>session · idle</span>
            </div>
            <div className="px-7 py-9">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
                ↳ access required
              </p>
              <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight">
                Sign in to spin up sandboxes.
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Persistent Daytona workspaces, wired to your GitHub repos in a single
                four-step flow.
              </p>
              <SignInButton>
                <button className="mt-7 inline-flex h-11 items-center gap-2.5 border border-foreground bg-foreground px-5 text-sm font-semibold uppercase tracking-[0.18em] text-background transition hover:bg-background hover:text-foreground">
                  Continue
                  <ArrowRight className="size-4" aria-hidden="true" />
                </button>
              </SignInButton>
            </div>
          </div>
        </main>
      </Unauthenticated>

      <AuthLoading>
        <div className="grid min-h-svh place-items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          <span className="font-mono text-[10px] uppercase tracking-[0.24em]">
            loading
          </span>
        </div>
      </AuthLoading>
    </>
  );
}
