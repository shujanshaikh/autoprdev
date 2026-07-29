import { createFileRoute } from "@tanstack/react-router";
import { api } from "@autopr/backend/convex/_generated/api";
import { Button } from "@autopr/ui/components/button";
import {
  Dialog,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@autopr/ui/components/tooltip";
import {
  useMutation as useReactMutation,
  useQuery as useReactQuery,
} from "@tanstack/react-query";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FileUIPart } from "ai";
import {
  ArrowRight,
  ArrowUp,
  CircleAlert,
  GitBranch,
  GitFork,
  GitPullRequest,
  ImagePlus,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Archive,
  Play,
  Search,
  Square,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";

import {
  usePromptImageUploadManager,
  type PromptImageUploadState,
} from "#/components/thread/prompt-image-uploads";
import {
  CodexPromptConnectionLine,
  type CodexPromptConnectionIssue,
} from "#/components/codex-prompt-connection-line";
import { DaytonaEnvironmentDialog } from "#/components/thread/daytona-environment-view";
import {
  DEFAULT_CODEX_REASONING_EFFORT,
  formatCodexModelLabel,
  getCodexModelOptions,
  getCodexReasoningEffortLabel,
  getCodexReasoningEfforts,
  normalizeCodexModelList,
  selectCodexModel,
  type CodexReasoningEffort,
} from "#/lib/codex-models";
import { useCodexStatus } from "#/lib/codex-status";
import { deleteThreadWithCleanup } from "#/lib/delete-thread";
import { buildThreadStartNavigation } from "#/lib/thread-start-navigation";
import { OpenGithubPullRequestDialog } from "#/components/github/open-pull-request-dialog";

const OPEN_PULL_REQUEST_VALUE = "__open_github_pull_request__";

function relativeTime(date: number) {
  const seconds = Math.floor((Date.now() - date) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type GithubBranch = {
  name: string;
  sha: string;
  protected: boolean;
};

type SandboxRuntimeStatus = "started" | "stopped" | "archived" | "unknown";
type ThreadWorkspaceMode = "checkout" | "worktree";

type ProjectPromptImage = {
  id: string;
  filename: string;
  mediaType: string;
  previewUrl: string;
  uploadState: PromptImageUploadState;
};

const EMPTY_BRANCHES: GithubBranch[] = [];

const threadPromptHandoffKey = (threadId: string) => `thread-prompt-handoff:${threadId}`;

const revokeObjectUrl = (url: string | undefined) => {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
};

function ThreadWorkspaceSelect({
  value,
  currentBranch,
  disabled,
  onChange,
}: {
  value: ThreadWorkspaceMode;
  currentBranch: string;
  disabled: boolean;
  onChange: (value: ThreadWorkspaceMode) => void;
}) {
  const isWorktree = value === "worktree";

  return (
    <Select value={value} onValueChange={(nextValue) => onChange(nextValue as ThreadWorkspaceMode)}>
      <SelectTrigger
        size="sm"
        className="h-7 max-w-[11rem] gap-1 border-none bg-transparent px-1.5 font-mono text-[11px] font-medium text-muted-foreground shadow-none transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:border-transparent focus-visible:ring-0 data-[size=sm]:h-7 dark:bg-transparent dark:hover:bg-muted/30 [&_[data-slot=select-value]]:min-w-0 [&_svg:not([class*='size-'])]:size-3.5"
        disabled={disabled}
        aria-label="Thread workspace"
      >
        {isWorktree ? (
          <GitFork className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
        ) : (
          <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        <SelectValue>{isWorktree ? "New worktree" : currentBranch}</SelectValue>
      </SelectTrigger>
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        side="top"
        sideOffset={8}
        className="w-72 min-w-72 rounded-[var(--radius-lg)] p-1"
      >
        <SelectItem value="checkout" className="rounded-[var(--radius-md)] py-2 pr-7 pl-2">
          <div className="flex min-w-0 items-start gap-2">
            <GitBranch className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-xs font-medium">Current checkout</span>
              <span className="block truncate font-mono text-[10px] text-muted-foreground">
                Use {currentBranch}; changes stay in this checkout.
              </span>
            </span>
          </div>
        </SelectItem>
        <SelectItem value="worktree" className="rounded-[var(--radius-md)] py-2 pr-7 pl-2">
          <div className="flex min-w-0 items-start gap-2">
            <GitFork className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-xs font-medium">New worktree</span>
              <span className="block text-[10px] text-muted-foreground">
                Create an isolated feature branch and checkout.
              </span>
            </span>
          </div>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data && typeof data === "object" && "error" in data ? String(data.error) : "Request failed.";
    throw new Error(error);
  }
  return data as T;
}


function ThreadRow({
  thread,
  projectId,
  onDelete,
  isDeleting,
}: {
  thread: {
    threadId: string;
    title: string;
    isLive?: boolean;
    updatedAt: number;
  };
  projectId: string;
  onDelete: (threadId: string, title: string) => void;
  isDeleting: boolean;
}) {
  return (
    <div className="group flex items-center transition-colors hover:bg-muted/40">
      <Link
        to="/project/$projectId/thread/$threadId"
        params={{ projectId, threadId: thread.threadId }}
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5"
      >
        <MessageSquare
          className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary/70"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[13px] font-medium leading-tight text-foreground/90 group-hover:text-foreground">
              {thread.title}
            </p>
            {thread.isLive ? (
              <span className="inline-flex items-center gap-1 rounded-[var(--radius-xs)] border border-primary/20 bg-primary/8 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.12em] text-primary">
                <span className="size-1 animate-pulse rounded-full bg-primary" />
                live
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">
            {relativeTime(thread.updatedAt)}
          </p>
        </div>
        <ArrowRight
          className="size-3.5 shrink-0 text-muted-foreground/30 transition-all group-hover:translate-x-0.5 group-hover:text-muted-foreground/60"
          aria-hidden="true"
        />
      </Link>
      <button
        type="button"
        disabled={isDeleting}
        onClick={() => onDelete(thread.threadId, thread.title)}
        className="mr-2 inline-flex size-8 items-center justify-center rounded-full border border-destructive/20 bg-destructive/5 text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={`Delete thread ${thread.title}`}
        title="Delete thread"
      >
        {isDeleting ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}


function ProjectOverviewPage() {
  const { projectId } = Route.useParams();
  const router = useRouter();
  const navigate = useNavigate();
  const { isAuthenticated } = useConvexAuth();
  const project = useQuery(api.projects.get, isAuthenticated ? { projectId } : "skip");
  const threads = useQuery(api.threads.listByProject, isAuthenticated ? { projectId } : "skip");
  const userSettings = useQuery(api.userSettings.get, isAuthenticated ? {} : "skip");
  const codexStatusQuery = useCodexStatus(isAuthenticated);
  const createThread = useMutation(api.threads.create);
  const getSandboxRuntimeStatus = useAction(api.projectActions.getSandboxRuntimeStatus);
  const startSandbox = useAction(api.projectActions.startSandbox);
  const stopSandbox = useAction(api.projectActions.stopSandbox);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [isOpeningPullRequest, setIsOpeningPullRequest] = useState(false);
  const [deletingThreadId, setDeletingThreadId] = useState<string | undefined>();
  const [pendingDeleteThread, setPendingDeleteThread] = useState<{ threadId: string; title: string } | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [selectedBranchOverride, setSelectedBranchOverride] = useState<{ projectId: string; branch: string } | undefined>();
  const [selectedModelChoice, setSelectedModelChoice] = useState<string | undefined>();
  const [workspaceMode, setWorkspaceMode] = useState<ThreadWorkspaceMode>("checkout");
  const availableCodexModels = useMemo(
    () => normalizeCodexModelList(codexStatusQuery.data?.models),
    [codexStatusQuery.data?.models],
  );
  const selectedModel = useMemo(
    () => selectCodexModel(availableCodexModels, selectedModelChoice),
    [availableCodexModels, selectedModelChoice],
  );
  const modelOptions = useMemo(
    () => getCodexModelOptions(availableCodexModels, selectedModel),
    [availableCodexModels, selectedModel],
  );
  const [selectedReasoningEffortChoice, setSelectedReasoningEffortChoice] = useState<CodexReasoningEffort>(
    DEFAULT_CODEX_REASONING_EFFORT,
  );
  const [demoEnabled, setDemoEnabled] = useState(false);
  const demoRecordingExperimentEnabled = Boolean(userSettings?.demoRecordingExperimentEnabled);
  const selectedReasoningEfforts = useMemo(() => getCodexReasoningEfforts(selectedModel), [selectedModel]);
  const selectedReasoningEffort = selectedReasoningEfforts.includes(selectedReasoningEffortChoice)
    ? selectedReasoningEffortChoice
    : DEFAULT_CODEX_REASONING_EFFORT;
  const effectiveDemoEnabled = demoRecordingExperimentEnabled && demoEnabled;
  const [promptValue, setPromptValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [sandboxRuntimeStatusOverride, setSandboxRuntimeStatusOverride] = useState<{
    projectId: string;
    status: SandboxRuntimeStatus;
  } | undefined>();
  const [isTogglingSandbox, setIsTogglingSandbox] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const promptImageInputRef = useRef<HTMLInputElement>(null);
  const promptImageUploadPromisesRef = useRef<Map<string, Promise<FileUIPart>>>(null!);
  promptImageUploadPromisesRef.current ??= new Map<string, Promise<FileUIPart>>();
  const promptImagesRef = useRef<ProjectPromptImage[]>([]);
  const imageUploads = usePromptImageUploadManager();
  const [promptImages, setPromptImagesState] = useState<ProjectPromptImage[]>([]);

  const setPromptImages = useCallback((updater: SetStateAction<ProjectPromptImage[]>) => {
    const currentImages = promptImagesRef.current;
    const nextImages = typeof updater === "function" ? updater(currentImages) : updater;

    promptImagesRef.current = nextImages;
    setPromptImagesState(nextImages);
  }, []);

  const openThreads = threads?.filter((t) => t.isLive) ?? [];
  const checkoutOpenThreads = openThreads.filter((thread) =>
    thread.workspaceMode === "checkout" ||
    (thread.workspaceMode === undefined && !thread.featureBranch && !thread.worktreePath),
  );
  const currentBranch = project?.currentBranch ?? project?.repoBranch ?? project?.defaultBranch ?? "main";
  const selectedBranch =
    selectedBranchOverride?.projectId === projectId && selectedBranchOverride.branch !== currentBranch
      ? selectedBranchOverride.branch
      : currentBranch;
  const filteredThreads = threads?.filter((t) =>
    searchQuery ? t.title.toLowerCase().includes(searchQuery.toLowerCase()) : true,
  );

  const branchesQuery = useReactQuery({
    queryKey: ["github", "branches", project?.repoOwner, project?.repoName],
    enabled: isAuthenticated && Boolean(project),
    queryFn: async () => {
      if (!project) {
        return { branches: EMPTY_BRANCHES };
      }

      return readJson<{ branches: GithubBranch[] }>(
        await fetch(
          `/api/github/repositories/${encodeURIComponent(project.repoOwner)}/${encodeURIComponent(project.repoName)}/branches`,
        ),
      );
    },
  });

  const branches = branchesQuery.data?.branches ?? EMPTY_BRANCHES;
  const isLoadingBranches = branchesQuery.isPending && Boolean(project);
  const branchesError =
    branchesQuery.error instanceof Error
      ? branchesQuery.error.message
      : branchesQuery.isError
        ? "Could not load branches."
        : undefined;
  const sandboxRuntimeStatusQuery = useReactQuery({
    queryKey: ["sandbox-runtime-status", projectId, project?.sandboxStatus],
    enabled: Boolean(project && project.sandboxStatus === "ready"),
    queryFn: () => getSandboxRuntimeStatus({ projectId, forceRefresh: true }),
  });

  const switchBranchMutation = useReactMutation({
    mutationFn: async (branch: string) =>
      readJson<{ status: "ready" }>(
        await fetch(`/api/project/${projectId}/branch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branch }),
        }),
      ),
    onMutate: () => {
      setError(undefined);
    },
    onError: (branchError) => {
      setSelectedBranchOverride(undefined);
      setError(branchError instanceof Error ? branchError.message : "Could not switch branches.");
    },
  });

  const isSwitchingBranch = switchBranchMutation.isPending;
  const mutateSwitchBranch = switchBranchMutation.mutate;
  const displayedError = error ?? branchesError;
  const refreshedSandboxRuntimeStatus = sandboxRuntimeStatusQuery.isError
    ? "unknown"
    : sandboxRuntimeStatusQuery.data?.status;
  const effectiveSandboxRuntimeStatus =
    sandboxRuntimeStatusOverride?.projectId === projectId
      ? sandboxRuntimeStatusOverride.status
      : refreshedSandboxRuntimeStatus ?? project?.sandboxRuntimeStatus;
  const isCheckingSandboxRuntime = sandboxRuntimeStatusQuery.isFetching;
  const isSandboxStarted = effectiveSandboxRuntimeStatus === "started";
  const isCodexConnected = codexStatusQuery.data?.connected === true;
  const codexPromptIssue: CodexPromptConnectionIssue | undefined =
    project?.sandboxStatus === "ready" && codexStatusQuery.data?.connected === false
      ? "disconnected"
      : project?.sandboxStatus === "ready" && codexStatusQuery.isError
        ? "unavailable"
        : undefined;
  const promptReady = Boolean(project && project.sandboxStatus === "ready" && isCodexConnected);
  const promptControlsDisabled = !promptReady || isCreatingThread;
  const sandboxRuntimeButton = (() => {
    if (isTogglingSandbox) {
      return { icon: Loader2, label: "Updating Sandbox", variant: "outline" as const };
    }

    if (isCheckingSandboxRuntime) {
      return { icon: Loader2, label: "Checking Sandbox", variant: "outline" as const };
    }

    if (effectiveSandboxRuntimeStatus === "started") {
      return { icon: Square, label: "Stop Sandbox", variant: "outline" as const };
    }

    if (effectiveSandboxRuntimeStatus === "archived") {
      return { icon: Archive, label: "Start Archived Sandbox", variant: "secondary" as const };
    }

    if (effectiveSandboxRuntimeStatus === "unknown") {
      return { icon: Play, label: "Start Sandbox (Unknown)", variant: "default" as const };
    }

    return { icon: Play, label: "Start Sandbox", variant: "default" as const };
  })();
  const SandboxRuntimeButtonIcon = sandboxRuntimeButton.icon;

  const removePromptImage = useCallback((id: string) => {
    setPromptImages((currentImages) => {
      const image = currentImages.find((candidate) => candidate.id === id);
      revokeObjectUrl(image?.previewUrl);

      return currentImages.filter((candidate) => candidate.id !== id);
    });
    promptImageUploadPromisesRef.current.delete(id);
  }, [setPromptImages]);

  const addPromptImages = useCallback((files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));

    if (imageFiles.length === 0) {
      return;
    }

    for (const file of imageFiles) {
      const id = nanoid();
      const previewUrl = URL.createObjectURL(file);
      const filename = file.name || "Pasted image";
      const mediaType = file.type || "image/png";

      setPromptImages((currentImages) => [
        ...currentImages,
        {
          id,
          filename,
          mediaType,
          previewUrl,
          uploadState: { status: "uploading" },
        },
      ]);

      const uploadPromise = imageUploads.uploadImageFile(file)
        .then((part) => {
          setPromptImages((currentImages) => currentImages.map((image) => {
            if (image.id !== id) {
              return image;
            }

            revokeObjectUrl(image.previewUrl);

            return {
              ...image,
              previewUrl: part.url,
              uploadState: { status: "uploaded", part },
            };
          }));

          return part;
        })
        .catch((uploadError) => {
          const message = uploadError instanceof Error ? uploadError.message : "Image upload failed.";
          setPromptImages((currentImages) => currentImages.map((image) => (
            image.id === id
              ? {
                  ...image,
                  uploadState: { status: "error", error: message },
                }
              : image
          )));
          throw new Error(message);
        });

      promptImageUploadPromisesRef.current.set(id, uploadPromise);
      void uploadPromise.catch(() => undefined).finally(() => {
        promptImageUploadPromisesRef.current.delete(id);
      });
    }
  }, [imageUploads, setPromptImages]);

  const resolvePromptImages = useCallback(async () => {
    const images = promptImagesRef.current;

    return await Promise.all(images.map(async (image) => {
      if (image.uploadState.status === "uploaded") {
        return image.uploadState.part;
      }

      if (image.uploadState.status === "error") {
        throw new Error(image.uploadState.error);
      }

      const pendingUpload = promptImageUploadPromisesRef.current.get(image.id);
      if (pendingUpload) {
        return await pendingUpload;
      }

      throw new Error(`Image upload did not finish for ${image.filename}.`);
    }));
  }, []);

  const clearPromptImages = useCallback(() => {
    for (const image of promptImagesRef.current) {
      revokeObjectUrl(image.previewUrl);
    }

    promptImagesRef.current = [];
    promptImageUploadPromisesRef.current.clear();
    setPromptImagesState([]);
  }, []);

  const handlePromptImageInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    addPromptImages(Array.from(event.currentTarget.files ?? []));
    event.currentTarget.value = "";
  }, [addPromptImages]);

  const handlePromptPaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = [];
    for (const item of event.clipboardData.items) {
      if (item.kind !== "file") {
        continue;
      }

      const file = item.getAsFile();
      if (file?.type.startsWith("image/")) {
        files.push(file);
      }
    }

    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    addPromptImages(files);
  }, [addPromptImages]);

  useEffect(() => () => {
    for (const image of promptImagesRef.current) {
      revokeObjectUrl(image.previewUrl);
    }

    promptImagesRef.current = [];
    promptImageUploadPromisesRef.current.clear();
  }, []);

  useEffect(() => {
    if (
      selectedModelChoice &&
      codexStatusQuery.data?.models !== undefined &&
      !availableCodexModels.includes(selectedModelChoice)
    ) {
      setSelectedModelChoice(undefined);
    }
  }, [availableCodexModels, codexStatusQuery.data?.models, selectedModelChoice]);

  const startThread = useCallback(async (initialPrompt?: string) => {
    if (!project || !promptReady) return;
    const prompt = (initialPrompt ?? promptValue).trim();
    setIsCreatingThread(true);
    setError(undefined);
    try {
      const uploadedImages = await resolvePromptImages();
      const threadId = await createThread({
        projectId,
        title: "New thread",
        demoEnabled: effectiveDemoEnabled,
        workspaceMode,
      });
      if (uploadedImages.length > 0) {
        window.sessionStorage.setItem(
          threadPromptHandoffKey(threadId),
          JSON.stringify({ text: prompt, files: uploadedImages }),
        );
      }
      const navigation = buildThreadStartNavigation({
        projectId,
        threadId,
        prompt,
        model: selectedModel,
        reasoningEffort: selectedReasoningEffort,
      });
      await router.preloadRoute(navigation);
      navigate(navigation);
      clearPromptImages();
    } catch (threadError) {
      setError(threadError instanceof Error ? threadError.message : "Could not create a thread.");
      setIsCreatingThread(false);
    }
  }, [
    clearPromptImages,
    createThread,
    effectiveDemoEnabled,
    navigate,
    project,
    projectId,
    promptValue,
    promptReady,
    resolvePromptImages,
    router,
    selectedModel,
    selectedReasoningEffort,
    workspaceMode,
  ]);

  const handlePromptSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      void startThread();
    },
    [startThread],
  );

  const toggleSandboxRuntime = useCallback(async () => {
    if (!project || project.sandboxStatus !== "ready" || isTogglingSandbox) {
      return;
    }

    setIsTogglingSandbox(true);
    setError(undefined);
    try {
      const result = isSandboxStarted
        ? await stopSandbox({ projectId })
        : await startSandbox({ projectId });
      setSandboxRuntimeStatusOverride({ projectId, status: result.status });
    } catch (sandboxError) {
      setError(sandboxError instanceof Error ? sandboxError.message : "Could not update the sandbox.");
    } finally {
      setIsTogglingSandbox(false);
    }
  }, [isSandboxStarted, isTogglingSandbox, project, projectId, startSandbox, stopSandbox]);

  const handleDeleteThread = useCallback(
    async (threadId: string, title: string) => {
      setPendingDeleteThread({ threadId, title });
    },
    [],
  );

  const confirmDeleteThread = useCallback(async () => {
    if (!pendingDeleteThread) {
      return;
    }

    setDeletingThreadId(pendingDeleteThread.threadId);
    setError(undefined);
    try {
      await deleteThreadWithCleanup(projectId, pendingDeleteThread.threadId);
      setPendingDeleteThread(undefined);
    } catch (threadError) {
      setError(threadError instanceof Error ? threadError.message : "Could not delete the thread.");
    } finally {
      setDeletingThreadId(undefined);
    }
  }, [pendingDeleteThread, projectId]);

  const isConfirmingDelete = Boolean(pendingDeleteThread);
  const isDeletingPendingThread = Boolean(pendingDeleteThread && deletingThreadId === pendingDeleteThread.threadId);

  const closeDeleteDialog = useCallback(() => {
    if (isDeletingPendingThread) {
      return;
    }

    setPendingDeleteThread(undefined);
  }, [isDeletingPendingThread]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.cssText += `; height: auto; height: ${Math.min(el.scrollHeight, 160)}px;`;
  }, [promptValue]);

  const switchBranch = useCallback(async (branch: string) => {
    if (!project || branch === currentBranch) {
      setSelectedBranchOverride(undefined);
      return;
    }

    if (checkoutOpenThreads.length > 0) {
      const confirmed = window.confirm(
        `Switching branch changes the checkout used by ${checkoutOpenThreads.length} live checkout-backed thread${checkoutOpenThreads.length === 1 ? "" : "s"}. Worktree-backed threads are unaffected.`,
      );
      if (!confirmed) {
        setSelectedBranchOverride(undefined);
        return;
      }
    }

    setSelectedBranchOverride({ projectId, branch });
    mutateSwitchBranch(branch);
  }, [checkoutOpenThreads.length, currentBranch, project, projectId, mutateSwitchBranch]);

  const quickActions = [
    "Summarize latest changes",
    "Review my latest PR",
    "Suggest a new feature",
    "Create a task for…",
  ];

  return (
    <>
    <Dialog open={isConfirmingDelete} onOpenChange={(open) => (!open ? closeDeleteDialog() : null)}>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="minimal-scrollbar relative flex flex-1 flex-col overflow-y-auto">
          {project === undefined || threads === undefined ? (
            <div className="grid flex-1 place-items-center">
              <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="size-5 animate-spin text-primary/50" aria-hidden="true" />
                <span className="font-mono text-xs tracking-wide">Loading project…</span>
              </div>
            </div>
          ) : !project ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="border border-border px-6 py-5 text-sm text-muted-foreground">
                Project not found.
              </div>
            </div>
          ) : (
                <>
                  <div className="flex flex-1 flex-col items-center justify-center px-5 py-16 sm:px-8">
                    <div className="w-full max-w-[600px]">
                      {/* Heading */}
                      <div className="mb-6 text-center">
                        <h1 className="type-feature-heading text-foreground">
                          What do you want to work on?
                        </h1>
                        <div className="mt-2 flex flex-wrap items-center justify-center gap-2 font-mono text-[11px] text-muted-foreground/70">
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <GitBranch className="size-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{project.repoFullName ?? "project"}</span>
                          </span>
                          <Select value={selectedBranch} onValueChange={(branch) => {
                            if (branch === OPEN_PULL_REQUEST_VALUE) {
                              setIsOpeningPullRequest(true);
                            } else if (branch) {
                              void switchBranch(branch);
                            }
                          }}>
                            <SelectTrigger
                              size="sm"
                              className="h-7 max-w-64 border-border/70 bg-background/35 px-2.5 font-mono text-[11px] text-muted-foreground/90 hover:border-border hover:bg-muted/35 hover:text-foreground [&_[data-slot=select-value]]:min-w-0"
                              disabled={
                                project.sandboxStatus !== "ready" ||
                                project.branchSwitchStatus === "switching" ||
                                isCreatingThread ||
                                isLoadingBranches ||
                                isSwitchingBranch
                              }
                            >
                              <SelectValue placeholder={isLoadingBranches ? "Loading branches" : currentBranch} />
                            </SelectTrigger>
                            <SelectContent
                              align="start"
                              alignItemWithTrigger={false}
                              className="max-h-72 w-[min(calc(100vw-2rem),22rem)] min-w-64 p-1"
                            >
                              {branches.map((branch) => (
                                <SelectItem
                                  key={branch.sha}
                                  value={branch.name}
                                  className="rounded-sm py-1.5 pr-7 pl-2 text-[11px] [&>span:first-of-type]:min-w-0 [&>span:first-of-type]:shrink"
                                >
                                  <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                                    <GitBranch className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                                    <span className="min-w-0 truncate font-mono text-foreground/90">{branch.name}</span>
                                    {branch.protected ? (
                                      <span className="shrink-0 rounded-[3px] border border-border/70 px-1 py-0.5 text-[10px] leading-none text-muted-foreground">
                                        protected
                                      </span>
                                    ) : null}
                                  </span>
                                </SelectItem>
                              ))}
                              <SelectItem value={OPEN_PULL_REQUEST_VALUE} className="mt-1 border-t border-border pt-2">
                                <span className="flex items-center gap-2 font-medium text-primary">
                                  <GitPullRequest className="size-3" aria-hidden="true" />
                                  Open GitHub PR…
                                </span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          {isSwitchingBranch || project.branchSwitchStatus === "switching" ? (
                            <Loader2 className="size-3 animate-spin text-primary" aria-hidden="true" />
                          ) : null}
                        </div>
                      </div>

                      <form onSubmit={handlePromptSubmit}>
                        <input
                          aria-label="Attach prompt images"
                          ref={promptImageInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          disabled={promptControlsDisabled}
                          onChange={handlePromptImageInputChange}
                        />
                        <div
                          className={`overflow-hidden rounded-[var(--radius-xxl)] border bg-muted/35 transition-[border-color,background-color,box-shadow] duration-200 dark:bg-muted/20 ${isFocused
                            ? "border-border/80 bg-muted/45 shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring)_12%,transparent)] dark:bg-muted/30"
                            : "border-border/55 hover:border-border/70"
                            }`}
                        >
                          <CodexPromptConnectionLine issue={codexPromptIssue} className="rounded-t-[var(--radius-xxl)] border-b-border/40 bg-transparent px-3.5" />
                          {promptImages.length > 0 ? (
                            <div className="flex flex-wrap gap-2 px-3.5 pt-3">
                              {promptImages.map((image) => (
                                <div
                                  key={image.id}
                                  className="group/image relative size-14 overflow-hidden rounded-[var(--radius-md)] border border-border/50 bg-muted"
                                >
                                  <img
                                    alt={image.filename}
                                    className="h-full w-full object-cover"
                                    src={image.previewUrl}
                                  />
                                  {image.uploadState.status === "uploading" ? (
                                    <output
                                      aria-label="Image upload in progress"
                                      className="absolute inset-0 grid place-items-center bg-background/70"
                                    >
                                      <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
                                    </output>
                                  ) : null}
                                  {image.uploadState.status === "error" ? (
                                    <output
                                      aria-label="Image upload failed"
                                      className="absolute inset-0 grid place-items-center bg-destructive/15 text-destructive"
                                      title={image.uploadState.error}
                                    >
                                      <CircleAlert className="size-4" aria-hidden="true" />
                                    </output>
                                  ) : null}
                                  <button
                                    type="button"
                                    aria-label={`Remove ${image.filename}`}
                                    className="absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground opacity-0 shadow-none transition hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/image:opacity-100"
                                    disabled={promptControlsDisabled}
                                    onClick={() => removePromptImage(image.id)}
                                  >
                                    <X className="size-3" aria-hidden="true" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : null}

                          <div className={`px-3.5 pb-1 ${promptImages.length > 0 ? "pt-2" : "pt-3"}`}>
                            <textarea
                              aria-label="Thread prompt"
                              ref={textareaRef}
                              value={promptValue}
                              onChange={(e) => setPromptValue(e.target.value)}
                              onPaste={handlePromptPaste}
                              onFocus={() => setIsFocused(true)}
                              onBlur={() => setIsFocused(false)}
                              placeholder={`Ask ${project.repoFullName?.split("/")[1] ?? "the agent"} anything…`}
                              disabled={promptControlsDisabled}
                              rows={1}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  void startThread();
                                }
                              }}
                              className="w-full resize-none bg-transparent text-[14px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-50"
                              style={{ minHeight: "28px", maxHeight: "160px" }}
                            />
                          </div>

                          <div className="flex items-center justify-between gap-1.5 px-2 pb-2 pt-0.5">
                            <div className="flex min-w-0 flex-wrap items-center gap-0.5">
                              <ThreadWorkspaceSelect
                                value={workspaceMode}
                                currentBranch={currentBranch}
                                disabled={promptControlsDisabled}
                                onChange={setWorkspaceMode}
                              />
                              <button
                                type="button"
                                aria-label="Add photos"
                                title="Add photos"
                                onClick={() => promptImageInputRef.current?.click()}
                                disabled={promptControlsDisabled}
                                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted/70 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 dark:bg-muted/40"
                              >
                                <ImagePlus className="size-3.5" aria-hidden="true" />
                              </button>
                              <Select
                                value={selectedModel ?? ""}
                                onValueChange={(value) => value && setSelectedModelChoice(value)}
                              >
                                <SelectTrigger
                                  size="sm"
                                  className="h-7 max-w-[10rem] gap-1 border-none bg-transparent px-1.5 text-xs font-medium text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground focus-visible:border-transparent focus-visible:ring-0 data-[size=sm]:h-7 dark:bg-transparent dark:hover:bg-transparent [&_[data-slot=select-value]]:min-w-0 [&_svg:not([class*='size-'])]:size-3.5"
                                  disabled={promptControlsDisabled || modelOptions.length === 0}
                                  aria-label="Model"
                                >
                                  <SelectValue>
                                    {formatCodexModelLabel(selectedModel)}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent align="start" alignItemWithTrigger={false} side="top" sideOffset={8} className="w-52 min-w-52 rounded-[var(--radius-lg)] p-1">
                                  {modelOptions.map((model) => (
                                    <SelectItem key={model} value={model} className="rounded-[var(--radius-md)] py-1.5 pr-7 pl-2 text-xs">
                                      <span className="min-w-0 truncate font-medium">
                                        {formatCodexModelLabel(model)}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Select
                                value={selectedReasoningEffort}
                                onValueChange={(value) => value && setSelectedReasoningEffortChoice(value as CodexReasoningEffort)}
                              >
                                <SelectTrigger
                                  size="sm"
                                  className="h-7 max-w-24 gap-1 border-none bg-transparent px-1.5 text-xs font-medium text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground focus-visible:border-transparent focus-visible:ring-0 data-[size=sm]:h-7 dark:bg-transparent dark:hover:bg-transparent [&_[data-slot=select-value]]:min-w-0 [&_svg:not([class*='size-'])]:size-3.5"
                                  disabled={promptControlsDisabled}
                                  aria-label="Reasoning level"
                                >
                                  <SelectValue>
                                    {getCodexReasoningEffortLabel(selectedReasoningEffort)}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent align="start" alignItemWithTrigger={false} side="top" sideOffset={8} className="w-36 min-w-36 rounded-[var(--radius-lg)] p-1">
                                  {selectedReasoningEfforts.map((effort) => (
                                    <SelectItem key={effort} value={effort} className="rounded-[var(--radius-md)] py-1.5 pr-7 pl-2 text-xs">
                                      <span className="font-medium">
                                        {getCodexReasoningEffortLabel(effort)}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            {demoRecordingExperimentEnabled ? (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <button
                                      type="button"
                                      role="switch"
                                      aria-checked={effectiveDemoEnabled}
                                      onClick={() => setDemoEnabled((enabled) => !enabled)}
                                      disabled={promptControlsDisabled}
                                      className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-pill)] px-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                                        effectiveDemoEnabled
                                          ? "text-primary hover:text-primary"
                                          : "text-muted-foreground hover:text-foreground"
                                      }`}
                                    >
                                      <Video className="size-3.5" aria-hidden="true" />
                                      <span>Demo</span>
                                    </button>
                                  }
                                />
                                <TooltipContent side="top" align="start" className="max-w-64 rounded-[var(--radius-md)]">
                                  {effectiveDemoEnabled
                                    ? "Experimental: new threads will record a Daytona browser demo and may fail."
                                    : "Allow the agent to record an experimental Daytona browser demo for new threads."}
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                            </div>
                            <button
                              type="submit"
                              disabled={promptControlsDisabled}
                              className="inline-flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-none transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <ArrowUp className="size-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </form>

                      <div className="mt-3 flex flex-wrap justify-center gap-2">
                        <Button
                          type="button"
                          variant={sandboxRuntimeButton.variant}
                          size="sm"
                          onClick={() => void toggleSandboxRuntime()}
                          disabled={project.sandboxStatus !== "ready" || isTogglingSandbox || isCheckingSandboxRuntime}
                          className="h-8 gap-2 font-mono text-[11px]"
                        >
                          <SandboxRuntimeButtonIcon
                            className={`size-3.5 ${isTogglingSandbox || isCheckingSandboxRuntime ? "animate-spin" : ""}`}
                            aria-hidden="true"
                          />
                          {sandboxRuntimeButton.label}
                        </Button>
                        <DaytonaEnvironmentDialog
                          projectId={projectId}
                          disabled={project.sandboxStatus !== "ready" || isTogglingSandbox}
                        />
                      </div>

                      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                        {quickActions.map((action) => (
                          <button
                            key={action}
                            type="button"
                             onClick={() => {
                               setPromptValue(action);
                               void startThread(action);
                             }}
                            disabled={promptControlsDisabled}
                            className="rounded-[var(--radius-xl)] border border-border/60 px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-[color:var(--project-selected-strong)] hover:bg-[color:var(--project-selected)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {action}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {project.sandboxStatus === "creating" ? (
                    <div className="mx-auto w-full max-w-[600px] px-5">
                      <div className="border border-[color:color-mix(in_srgb,var(--cohere-coral)_25%,transparent)] bg-[color:color-mix(in_srgb,var(--cohere-coral)_5%,transparent)] px-4 py-3 text-[13px] text-[color:var(--cohere-coral)]">
                        <Loader2 className="mr-2 inline size-3.5 animate-spin" aria-hidden="true" />
                        Creating sandbox and cloning repository. Threads unlock when ready.
                      </div>
                    </div>
                  ) : null}

                  {project.sandboxStatus === "failed" ? (
                    <div className="mx-auto w-full max-w-[600px] px-5">
                      <div className="border border-destructive/25 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
                        <p>{project.sandboxError ?? "Sandbox creation failed."}</p>
                        <Link
                          to="/dashboard"
                          className="mt-2 inline-flex text-foreground underline underline-offset-4"
                        >
                          Open latest project
                        </Link>
                      </div>
                    </div>
                  ) : null}

                  {project.branchSwitchStatus === "switching" ? (
                    <div className="mx-auto w-full max-w-[600px] px-5 pt-2">
                      <div className="border border-[color:color-mix(in_srgb,var(--cohere-coral)_25%,transparent)] bg-[color:color-mix(in_srgb,var(--cohere-coral)_5%,transparent)] px-4 py-3 text-[13px] text-[color:var(--cohere-coral)]">
                        <Loader2 className="mr-2 inline size-3.5 animate-spin" aria-hidden="true" />
                        Switching branch and pulling latest changes…
                      </div>
                    </div>
                  ) : null}

                  {project.branchSwitchStatus === "failed" && project.branchSwitchError ? (
                    <div className="mx-auto w-full max-w-[600px] px-5 pt-2">
                      <div className="border border-destructive/25 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
                        {project.branchSwitchError}
                      </div>
                    </div>
                  ) : null}

                  {displayedError ? (
                    <div className="mx-auto w-full max-w-[600px] px-5 pt-2">
                      <div className="border border-destructive/25 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
                        {displayedError}
                      </div>
                    </div>
                  ) : null}

                  <div id="project-threads" className="scroll-mt-4 mx-auto w-full max-w-[600px] px-5 pt-2 pb-12">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex items-center gap-2">
                        {openThreads.length > 0 ? (
                          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/60">
                            <span className="size-1.5 rounded-full bg-primary/70" />
                            {openThreads.length} live
                          </span>
                        ) : null}
                        <h2 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/50">
                          Threads
                        </h2>
                      </div>

                      <div className="ml-auto flex items-center gap-1.5">
                        <label className="flex h-8 w-44 items-center gap-1.5 rounded-xs border border-border/60 bg-background px-2.5 text-xs text-muted-foreground transition-colors focus-within:border-[color:var(--cohere-form-focus)] focus-within:ring-1 focus-within:ring-ring/30">
                          <Search className="size-3 shrink-0 text-muted-foreground/40" aria-hidden="true" />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search…"
                            className="w-full bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => void startThread()}
                          disabled={promptControlsDisabled}
                          className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-pill)] border border-primary/20 bg-primary/6 px-3 font-mono text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <MessageSquarePlus className="size-3" aria-hidden="true" />
                          New
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsOpeningPullRequest(true)}
                          disabled={project.sandboxStatus !== "ready"}
                          className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-pill)] border border-border/70 px-3 font-mono text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <GitPullRequest className="size-3" aria-hidden="true" />
                          Open PR
                        </button>
                      </div>
                    </div>

                    <div className="divide-y divide-border/60 rounded-sm border border-border/60 bg-background">
                      {filteredThreads === undefined ? (
                        <div className="flex min-h-24 items-center justify-center text-[13px] text-muted-foreground/60">
                          <Loader2 className="mr-2 size-3.5 animate-spin" aria-hidden="true" />
                          Loading threads…
                        </div>
                      ) : filteredThreads.length === 0 ? (
                        <div className="px-4 py-8 text-center text-[13px] text-muted-foreground/50">
                          {searchQuery ? (
                            <>No threads match &quot;{searchQuery}&quot;</>
                          ) : (
                            "No threads yet. Start one above."
                          )}
                        </div>
                      ) : (
                        filteredThreads.map((thread) => (
                          <ThreadRow
                            key={thread.threadId}
                            thread={thread}
                            projectId={projectId}
                            onDelete={handleDeleteThread}
                            isDeleting={deletingThreadId === thread.threadId}
                          />
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete thread?</DialogTitle>
            <DialogDescription>
              This permanently deletes <span className="font-semibold text-foreground">{pendingDeleteThread?.title ?? "this thread"}</span> and all its messages.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={isDeletingPendingThread} onClick={closeDeleteDialog}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={isDeletingPendingThread} onClick={() => void confirmDeleteThread()}>
              {isDeletingPendingThread ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              Delete thread
            </Button>
          </DialogFooter>
        </DialogContent>
    </Dialog>
      <OpenGithubPullRequestDialog
        projectId={projectId}
        open={isOpeningPullRequest}
        onOpenChange={setIsOpeningPullRequest}
      />
    </>
  );
}

export const Route = createFileRoute("/project/$projectId/")({ component: ProjectOverviewPage });
