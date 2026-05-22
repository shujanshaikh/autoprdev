import { createFileRoute, Navigate } from "@tanstack/react-router";
import { api } from "@autopr/backend/convex/_generated/api";
import {
  useMutation as useReactMutation,
  useQuery as useReactQuery,
} from "@tanstack/react-query";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useConvexAuth,
  useAction,
  useQuery,
} from "convex/react";
import { Loader2 } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CreateSandboxPanel } from "#/components/dashboard/create-sandbox-panel";
import { CodexConnectDialog } from "#/components/dashboard/codex-connect-dialog";
import { DashboardHeader } from "#/components/dashboard/dashboard-header";
import { DeleteDialog } from "#/components/dashboard/delete-dialog";
import { ProjectGrid } from "#/components/dashboard/project-grid";
import { BillingHistory } from "#/components/dashboard/billing-history";
import { readJson, type GithubBranch, type GithubRepository } from "#/components/dashboard/types";

const EMPTY_REPOSITORIES: GithubRepository[] = [];
const EMPTY_BRANCHES: GithubBranch[] = [];

function Dashboard() {
  const navigate = useNavigate();
  const { isAuthenticated } = useConvexAuth();
  const projects = useQuery(api.projects.list, isAuthenticated ? {} : "skip");
  const sandboxCosts = useQuery(api.sandboxCosts.listForCurrentUser, isAuthenticated ? {} : "skip");
  const removeProjectWithSandbox = useAction(api.projectActions.removeWithSandbox);

  const [selectedRepoFullName, setSelectedRepoFullName] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [repoSearch, setRepoSearch] = useState("");
  const [isConnectingGithub, setIsConnectingGithub] = useState(false);
  const [projectIdToDelete, setProjectIdToDelete] = useState<string | undefined>();
  const [isCodexDialogOpen, setIsCodexDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const codexStatusQuery = useReactQuery({
    queryKey: ["codex", "status"],
    enabled: isAuthenticated,
    retry: false,
    queryFn: async () =>
      readJson<{
        connected: boolean;
        email?: string;
        accountId?: string;
      }>(await fetch("/api/codex/status")),
  });

  const repositoriesQuery = useReactQuery({
    queryKey: ["github", "repositories"],
    enabled: isAuthenticated,
    retry: false,
    queryFn: async () =>
      readJson<{ repositories: GithubRepository[] }>(
        await fetch("/api/github/repositories"),
      ),
  });

  const repositories = repositoriesQuery.data?.repositories ?? EMPTY_REPOSITORIES;
  const refetchRepositories = repositoriesQuery.refetch;
  const isLoadingRepos = repositoriesQuery.isPending;
  const isRefreshingRepos = repositoriesQuery.isFetching && !repositoriesQuery.isPending;
  const isGithubConnected = !repositoriesQuery.isError || repositories.length > 0;
  const repoError =
    repositoriesQuery.error instanceof Error
      ? repositoriesQuery.error.message
      : repositoriesQuery.isError
        ? "Could not load GitHub repositories."
        : undefined;

  const selectedRepo = useMemo(
    () => repositories.find((r) => r.fullName === selectedRepoFullName),
    [repositories, selectedRepoFullName],
  );

  const filteredRepositories = useMemo(() => {
    const search = repoSearch.trim().toLowerCase();
    if (!search) return repositories;
    return repositories.filter((r) => r.fullName.toLowerCase().includes(search));
  }, [repoSearch, repositories]);

  const branchesQuery = useReactQuery({
    queryKey: ["github", "branches", selectedRepo?.owner, selectedRepo?.name],
    enabled: isAuthenticated && Boolean(selectedRepo),
    queryFn: async () => {
      if (!selectedRepo) {
        return { branches: EMPTY_BRANCHES };
      }

      return readJson<{ branches: GithubBranch[] }>(
        await fetch(
          `/api/github/repositories/${encodeURIComponent(selectedRepo.owner)}/${encodeURIComponent(selectedRepo.name)}/branches`,
        ),
      );
    },
  });

  const branches = branchesQuery.data?.branches ?? EMPTY_BRANCHES;
  const isLoadingBranches = branchesQuery.isPending && Boolean(selectedRepo);
  const branchesError =
    branchesQuery.error instanceof Error
      ? branchesQuery.error.message
      : branchesQuery.isError
        ? "Could not load branches."
        : undefined;

  const createProjectMutation = useReactMutation({
    mutationFn: async () => {
      if (!selectedRepo || !selectedBranch) {
        throw new Error("Select a GitHub repository and branch.");
      }

      return readJson<{ projectId: string; error?: string }>(
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
    },
    onMutate: () => {
      setError(undefined);
    },
    onSuccess: (data) => {
      navigate({ to: "/project/$projectId", params: { projectId: data.projectId } });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not create the project sandbox.");
    },
  });

  const isCreating = createProjectMutation.isPending;

  const projectToDelete = useMemo(
    () => projects?.find((p) => p.projectId === projectIdToDelete),
    [projectIdToDelete, projects],
  );

  useEffect(() => {
    if (!repositories.length) {
      setSelectedRepoFullName("");
      return;
    }

    if (
      !selectedRepoFullName ||
      !repositories.some((repo) => repo.fullName === selectedRepoFullName)
    ) {
      setSelectedRepoFullName(repositories[0].fullName);
    }
  }, [repositories, selectedRepoFullName]);

  const refreshRepositories = useCallback(async () => {
    setError(undefined);
    await refetchRepositories();
  }, [refetchRepositories]);

  useEffect(() => {
    if (!selectedRepo) {
      setSelectedBranch("");
      return;
    }

    if (!branches.length) {
      setSelectedBranch("");
      return;
    }

    setSelectedBranch(
      branches.some((branch) => branch.name === selectedRepo.defaultBranch)
        ? selectedRepo.defaultBranch
        : branches[0]?.name ?? "",
    );
  }, [branches, selectedRepo]);

  async function connectGithub() {
    setIsConnectingGithub(true);
    setError(undefined);
    window.location.assign(`/api/github/connect?returnTo=${encodeURIComponent(window.location.href)}`);
  }

  async function createProject() {
    createProjectMutation.mutate();
  }

  async function deleteProject() {
    if (!projectToDelete) return;

    setIsDeleting(true);
    setError(undefined);

    try {
      await removeProjectWithSandbox({ projectId: projectToDelete.projectId });
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
        <div className="dashboard-shell relative flex h-svh min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
          <main className="mx-auto flex h-full w-full max-w-6xl flex-1 flex-col px-5 pt-5 pb-5 sm:px-8 lg:px-10">
            <DashboardHeader
              projectCount={projectCount}
              isCodexConnected={Boolean(codexStatusQuery.data?.connected)}
              onConnectCodex={() => setIsCodexDialogOpen(true)}
            />

            <div className="flex min-h-0 flex-1 flex-col gap-5">
              <div className="flex shrink-0 flex-col">
                <CreateSandboxPanel
                  isGithubConnected={isGithubConnected}
                  isConnectingGithub={isConnectingGithub}
                  isLoadingRepos={isLoadingRepos}
                  isRefreshingRepos={isRefreshingRepos}
                  isLoadingBranches={isLoadingBranches}
                  isCreating={isCreating}
                  repositories={repositories}
                  filteredRepositories={filteredRepositories}
                  branches={branches}
                  selectedRepoFullName={selectedRepoFullName}
                  selectedBranch={selectedBranch}
                  repoSearch={repoSearch}
                  selectedRepo={selectedRepo}
                  error={error ?? repoError ?? branchesError}
                  onConnectGithub={connectGithub}
                  onRefreshRepos={refreshRepositories}
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
              <BillingHistory rows={sandboxCosts} />
            </div>
          </main>

          <DeleteDialog
            open={Boolean(projectToDelete)}
            onOpenChange={(open) => !open && setProjectIdToDelete(undefined)}
            projectName={projectToDelete?.repoFullName ?? "this project"}
            isDeleting={isDeleting}
            onDelete={deleteProject}
          />
          <CodexConnectDialog
            open={isCodexDialogOpen}
            status={codexStatusQuery.data}
            onOpenChange={setIsCodexDialogOpen}
            onStatusChange={() => void codexStatusQuery.refetch()}
          />
        </div>
      </Authenticated>

      <Unauthenticated>
        <Navigate to="/sign-in" replace />
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

export const Route = createFileRoute("/dashboard")({ component: Dashboard });
