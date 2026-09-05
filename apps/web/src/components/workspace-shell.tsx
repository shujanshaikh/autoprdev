import { api } from "@autopr/backend/convex/_generated/api";
import type { SandboxProvider } from "@autopr/backend/convex/lib/sandboxProvider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@autopr/ui/components/dialog";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@autopr/ui/components/sidebar";
import { TooltipProvider } from "@autopr/ui/components/tooltip";
import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import {
  useMutation as useReactMutation,
  useQuery as useReactQuery,
} from "@tanstack/react-query";
import {
  useAction,
  useConvexAuth,
  useMutation as useConvexMutation,
  useQuery,
} from "convex/react";
import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { CreateSandboxPanel } from "#/components/dashboard/create-sandbox-panel";
import { DeleteDialog } from "#/components/dashboard/delete-dialog";
import {
  readJson,
  type GithubAppInstallation,
  type GithubBranch,
  type GithubRepository,
} from "#/components/dashboard/types";
import { RouteTransition } from "#/components/route-transition";
import {
  SettingsPage,
  SettingsSidebar,
  type SettingsTab,
  type WorkspaceSandboxCost,
  type WorkspaceUserSettings,
} from "#/components/settings/settings-workspace";
import {
  WorkspaceSidebar,
  type WorkspaceProject,
  type WorkspaceThread,
} from "#/components/workspace-sidebar";
import { useCodexStatus } from "#/lib/codex-status";
import { useGrokStatus } from "#/lib/grok-status";

const EMPTY_REPOSITORIES: GithubRepository[] = [];
const EMPTY_BRANCHES: GithubBranch[] = [];

function WorkspaceCreateSandboxDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { isAuthenticated } = useConvexAuth();
  const [selectedRepoFullNameOverride, setSelectedRepoFullNameOverride] = useState<string | undefined>();
  const [selectedBranchOverride, setSelectedBranchOverride] = useState<
    { repoFullName: string; branchName: string } | undefined
  >();
  const [repoSearch, setRepoSearch] = useState("");
  const [selectedSandboxProvider, setSelectedSandboxProvider] = useState<SandboxProvider>("daytona");
  const [isConnectingGithub, setIsConnectingGithub] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const repositoriesQuery = useReactQuery({
    queryKey: ["github", "repositories"],
    enabled: isAuthenticated && open,
    retry: false,
    queryFn: async () =>
      readJson<{ repositories: GithubRepository[] }>(
        await fetch("/api/github/repositories"),
      ),
  });

  const repositories = repositoriesQuery.data?.repositories ?? EMPTY_REPOSITORIES;
  const refetchRepositories = repositoriesQuery.refetch;
  const isLoadingRepos = repositoriesQuery.isPending && open;
  const isRefreshingRepos = repositoriesQuery.isFetching && !repositoriesQuery.isPending;
  const isGithubConnected = !repositoriesQuery.isError || repositories.length > 0;
  const repoError =
    repositoriesQuery.error instanceof Error
      ? repositoriesQuery.error.message
      : repositoriesQuery.isError
        ? "Could not load GitHub repositories."
        : undefined;

  const selectedRepoFullName =
    selectedRepoFullNameOverride &&
    repositories.some((repo) => repo.fullName === selectedRepoFullNameOverride)
      ? selectedRepoFullNameOverride
      : repositories[0]?.fullName ?? "";
  const selectedRepo = useMemo(
    () => repositories.find((r) => r.fullName === selectedRepoFullName),
    [repositories, selectedRepoFullName],
  );

  const filteredRepositories = useMemo(() => {
    const search = repoSearch.trim().toLowerCase();
    if (!search) return repositories;
    return repositories.filter((r) => r.fullName.toLowerCase().includes(search));
  }, [repoSearch, repositories]);

  const branchesQuery = useReactQuery<{
    branches: GithubBranch[];
    githubApp?: GithubAppInstallation;
  }>({
    queryKey: ["github", "branches", selectedRepo?.owner, selectedRepo?.name],
    enabled: isAuthenticated && open && Boolean(selectedRepo),
    queryFn: async () => {
      if (!selectedRepo) {
        return { branches: EMPTY_BRANCHES };
      }

      return readJson<{
        branches: GithubBranch[];
        githubApp: GithubAppInstallation;
      }>(
        await fetch(
          `/api/github/repositories/${encodeURIComponent(selectedRepo.owner)}/${encodeURIComponent(selectedRepo.name)}/branches`,
        ),
      );
    },
  });

  const branches = branchesQuery.data?.branches ?? EMPTY_BRANCHES;
  const githubAppInstallation = branchesQuery.data?.githubApp;
  const defaultBranchName =
    selectedRepo && branches.some((branch) => branch.name === selectedRepo.defaultBranch)
      ? selectedRepo.defaultBranch
      : branches[0]?.name ?? "";
  const selectedBranch =
    selectedBranchOverride?.repoFullName === selectedRepoFullName &&
    branches.some((branch) => branch.name === selectedBranchOverride.branchName)
      ? selectedBranchOverride.branchName
      : defaultBranchName;
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
      if (!githubAppInstallation?.installed) {
        throw new Error("Install Autopr on this repository before creating its sandbox.");
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
            sandboxProvider: selectedSandboxProvider,
          }),
        }),
      );
    },
    onMutate: () => {
      setError(undefined);
    },
    onSuccess: (data) => {
      onOpenChange(false);
      navigate({ to: "/project/$projectId", params: { projectId: data.projectId } });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not create the project sandbox.");
    },
  });

  const isCreating = createProjectMutation.isPending;

  const refreshRepositories = useCallback(async () => {
    setError(undefined);
    await refetchRepositories();
  }, [refetchRepositories]);

  function connectGithub() {
    setIsConnectingGithub(true);
    setError(undefined);
    window.location.assign(`/api/github/connect?returnTo=${encodeURIComponent(window.location.href)}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100svh-2rem)] max-h-[46rem] flex-col gap-0 overflow-hidden p-0 sm:h-auto sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3">
          <DialogTitle>Create a sandbox</DialogTitle>
          <DialogDescription>
            GitHub repository, branch, sandbox.
          </DialogDescription>
        </DialogHeader>
        <div className="minimal-scrollbar min-h-0 flex-1 overflow-hidden p-3 sm:overflow-y-auto sm:p-4">
          <CreateSandboxPanel
            isGithubConnected={isGithubConnected}
            isConnectingGithub={isConnectingGithub}
            isLoadingRepos={isLoadingRepos}
            isRefreshingRepos={isRefreshingRepos}
            isLoadingBranches={isLoadingBranches}
            isCheckingGithubAppInstallation={isLoadingBranches}
            isCreating={isCreating}
            repositories={repositories}
            filteredRepositories={filteredRepositories}
            branches={branches}
            selectedRepoFullName={selectedRepoFullName}
            selectedBranch={selectedBranch}
            selectedSandboxProvider={selectedSandboxProvider}
            repoSearch={repoSearch}
            selectedRepo={selectedRepo}
            githubAppInstallation={githubAppInstallation}
            error={error ?? repoError ?? branchesError}
            onConnectGithub={connectGithub}
            onRefreshRepos={refreshRepositories}
            onRepoSearchChange={setRepoSearch}
            onRepoChange={setSelectedRepoFullNameOverride}
            onBranchChange={(branchName) =>
              setSelectedBranchOverride({ repoFullName: selectedRepoFullName, branchName })
            }
            onSandboxProviderChange={setSelectedSandboxProvider}
            onCreate={() => createProjectMutation.mutate()}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceShell({
  activeProjectId,
  activeThreadId,
  settingsTab,
  children,
}: {
  activeProjectId?: string;
  activeThreadId?: string;
  settingsTab?: SettingsTab;
  children?: ReactNode | ((props: { openCreateProject: () => void }) => ReactNode);
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const { isAuthenticated } = useConvexAuth();
  const projects = useQuery(
    api.projects.list,
    isAuthenticated && (!settingsTab || settingsTab === "overview") ? {} : "skip",
  ) as WorkspaceProject[] | undefined;
  const threads = useQuery(
    api.threads.listForSidebar,
    isAuthenticated && !settingsTab ? {} : "skip",
  ) as WorkspaceThread[] | undefined;
  const sandboxCosts = useQuery(
    api.sandboxCosts.listForCurrentUser,
    isAuthenticated && (settingsTab === "overview" || settingsTab === "billing")
      ? {}
      : "skip",
  ) as WorkspaceSandboxCost[] | undefined;
  const userSettings = useQuery(
    api.userSettings.get,
    isAuthenticated && settingsTab === "labs" ? {} : "skip",
  ) as WorkspaceUserSettings | undefined;
  const removeProjectWithSandbox = useAction(api.projectActions.removeWithSandbox);
  const setDemoRecordingExperimentEnabled = useConvexMutation(
    api.userSettings.setDemoRecordingExperimentEnabled,
  );
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [projectIdToDelete, setProjectIdToDelete] = useState<string | undefined>();
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const [userSettingsSaving, setUserSettingsSaving] = useState(false);
  const [userSettingsError, setUserSettingsError] = useState<string | undefined>();
  const openCreateProject = useCallback(() => {
    setIsCreateDialogOpen(true);
  }, []);

  const codexStatusQuery = useCodexStatus(isAuthenticated && settingsTab === "models");
  const grokStatusQuery = useGrokStatus(isAuthenticated && settingsTab === "models");

  const projectToDelete = useMemo(
    () => projects?.find((p) => p.projectId === projectIdToDelete),
    [projectIdToDelete, projects],
  );

  async function deleteProject() {
    if (!projectToDelete) return;

    setIsDeletingProject(true);
    setDeleteError(undefined);

    try {
      await removeProjectWithSandbox({ projectId: projectToDelete.projectId });
      setProjectIdToDelete(undefined);
      if (projectToDelete.projectId === activeProjectId) {
        navigate({ to: "/dashboard" });
      }
      router.invalidate();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete the project.");
    } finally {
      setIsDeletingProject(false);
    }
  }

  const updateDemoRecordingExperimentEnabled = useCallback(async (enabled: boolean) => {
    setUserSettingsSaving(true);
    setUserSettingsError(undefined);

    try {
      await setDemoRecordingExperimentEnabled({ enabled });
    } catch (err) {
      setUserSettingsError(err instanceof Error ? err.message : "Could not update settings.");
    } finally {
      setUserSettingsSaving(false);
    }
  }, [setDemoRecordingExperimentEnabled]);

  const openSettings = useCallback(() => {
    void navigate({
      to: "/settings/$section",
      params: { section: "overview" },
    });
  }, [navigate]);

  const selectSettingsTab = useCallback((tab: SettingsTab) => {
    void navigate({
      to: "/settings/$section",
      params: { section: tab },
      replace: true,
    });
  }, [navigate]);

  const closeSettings = useCallback(() => {
    if (canGoBack) {
      window.history.back();
      return;
    }

    void navigate({ to: "/dashboard", replace: true });
  }, [canGoBack, navigate]);

  return (
    <TooltipProvider>
      <SidebarProvider
        className="project-shell h-dvh max-h-dvh overflow-hidden"
        style={{ "--sidebar-width": "18rem" } as CSSProperties}
      >
        {settingsTab ? (
          <SettingsSidebar
            activeTab={settingsTab}
            onSelect={selectSettingsTab}
            onBack={closeSettings}
          />
        ) : (
          <WorkspaceSidebar
            projects={projects}
            threads={threads}
            activeProjectId={activeProjectId}
            activeThreadId={activeThreadId}
            onCreateProject={openCreateProject}
            onDeleteProject={(projectId) => setProjectIdToDelete(projectId)}
            onOpenSettings={openSettings}
          />
        )}
        <div className="fixed left-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-40 md:hidden">
          <SidebarTrigger className="border border-border bg-background" />
        </div>
        {settingsTab ? (
          <SettingsPage
            activeTab={settingsTab}
            projects={projects}
            sandboxCosts={sandboxCosts}
            userSettings={userSettings}
            userSettingsSaving={userSettingsSaving}
            userSettingsError={userSettingsError}
            onDemoRecordingExperimentEnabledChange={updateDemoRecordingExperimentEnabled}
            codexStatus={codexStatusQuery.data}
            onCodexStatusChange={() => void codexStatusQuery.refetch()}
            grokStatus={grokStatusQuery.data}
            onGrokStatusChange={() => void grokStatusQuery.refetch()}
          />
        ) : (
          <SidebarInset className="min-w-0 overflow-hidden">
            <RouteTransition>
              {typeof children === "function"
                ? children({ openCreateProject })
                : children}
            </RouteTransition>
          </SidebarInset>
        )}

        <WorkspaceCreateSandboxDialog
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
        />
        <DeleteDialog
          open={Boolean(projectToDelete)}
          onOpenChange={(open) => {
            if (!open) {
              setProjectIdToDelete(undefined);
              setDeleteError(undefined);
            }
          }}
          projectName={projectToDelete?.repoFullName ?? "this project"}
          isDeleting={isDeletingProject}
          onDelete={deleteProject}
        />
        {deleteError ? (
          <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 border border-destructive/30 bg-popover px-3 py-2 text-xs text-destructive">
            {deleteError}
          </div>
        ) : null}
      </SidebarProvider>
    </TooltipProvider>
  );
}
