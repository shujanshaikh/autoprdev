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
  CODEX_MODELS,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT,
  getCodexReasoningEfforts,
  type CodexModelId,
  type CodexReasoningEffort,
} from "#/lib/codex-models";

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
            <p className="truncate text-[13px] font-semibold leading-tight text-foreground/90 group-hover:text-foreground">
              {thread.title}
            </p>
            {thread.isLive ? (
              <span className="inline-flex items-center gap-1 border border-primary/20 bg-primary/8 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.12em] text-primary">
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
        className="mr-2 inline-flex size-8 items-center justify-center border border-destructive/20 bg-destructive/5 text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
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
  const createThread = useMutation(api.threads.create);
  const removeThread = useMutation(api.threads.remove);
  const getSandboxRuntimeStatus = useAction(api.projectActions.getSandboxRuntimeStatus);
  const startSandbox = useAction(api.projectActions.startSandbox);
  const stopSandbox = useAction(api.projectActions.stopSandbox);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [deletingThreadId, setDeletingThreadId] = useState<string | undefined>();
  const [pendingDeleteThread, setPendingDeleteThread] = useState<{ threadId: string; title: string } | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [selectedBranch, setSelectedBranch] = useState("");
  const selectedModel: CodexModelId = DEFAULT_CODEX_MODEL;
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<CodexReasoningEffort>(
    DEFAULT_CODEX_REASONING_EFFORT,
  );
  const [demoEnabled, setDemoEnabled] = useState(false);
  const selectedReasoningEfforts = useMemo(() => getCodexReasoningEfforts(selectedModel), [selectedModel]);
  const [promptValue, setPromptValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [sandboxRuntimeStatus, setSandboxRuntimeStatus] = useState<"started" | "stopped" | "archived" | "unknown" | undefined>();
  const [isCheckingSandboxRuntime, setIsCheckingSandboxRuntime] = useState(false);
  const [isTogglingSandbox, setIsTogglingSandbox] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const promptImageInputRef = useRef<HTMLInputElement>(null);
  const promptImageUploadPromisesRef = useRef(new Map<string, Promise<FileUIPart>>());
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
  const currentBranch = project?.currentBranch ?? project?.repoBranch ?? project?.defaultBranch ?? "main";
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
      setSelectedBranch(currentBranch);
      setError(branchError instanceof Error ? branchError.message : "Could not switch branches.");
    },
  });

  const isSwitchingBranch = switchBranchMutation.isPending;
  const mutateSwitchBranch = switchBranchMutation.mutate;
  const displayedError = error ?? branchesError;
  const effectiveSandboxRuntimeStatus = sandboxRuntimeStatus ?? project?.sandboxRuntimeStatus;
  const isSandboxStarted = effectiveSandboxRuntimeStatus === "started";
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
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file && file.type.startsWith("image/")));

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

  const startThread = useCallback(async (initialPrompt?: string) => {
    if (!project || project.sandboxStatus !== "ready") return;
    const prompt = (initialPrompt ?? promptValue).trim();
    setIsCreatingThread(true);
    setError(undefined);
    try {
      const uploadedImages = await resolvePromptImages();
      const threadId = await createThread({ projectId, title: prompt || "New thread", demoEnabled });
      if (uploadedImages.length > 0) {
        window.sessionStorage.setItem(
          threadPromptHandoffKey(threadId),
          JSON.stringify({ text: prompt, files: uploadedImages }),
        );
      }
      const search = prompt
        ? { prompt, model: selectedModel, reasoningEffort: selectedReasoningEffort }
        : { model: selectedModel, reasoningEffort: selectedReasoningEffort };
      await router.preloadRoute({ to: "/project/$projectId/thread/$threadId", params: { projectId, threadId }, search });
      navigate({ to: "/project/$projectId/thread/$threadId", params: { projectId, threadId }, search });
      clearPromptImages();
    } catch (threadError) {
      setError(threadError instanceof Error ? threadError.message : "Could not create a thread.");
      setIsCreatingThread(false);
    }
  }, [
    clearPromptImages,
    createThread,
    demoEnabled,
    navigate,
    project,
    projectId,
    promptValue,
    resolvePromptImages,
    router,
    selectedModel,
    selectedReasoningEffort,
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
      setSandboxRuntimeStatus(result.status);
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
      await removeThread({ threadId: pendingDeleteThread.threadId });
      setPendingDeleteThread(undefined);
    } catch (threadError) {
      setError(threadError instanceof Error ? threadError.message : "Could not delete the thread.");
    } finally {
      setDeletingThreadId(undefined);
    }
  }, [pendingDeleteThread, removeThread]);

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

  useEffect(() => {
    if (!project) return;
    setSelectedBranch(currentBranch);
    setSandboxRuntimeStatus(project.sandboxRuntimeStatus);
  }, [currentBranch, project]);

  useEffect(() => {
    if (!project || project.sandboxStatus !== "ready") return;
    let cancelled = false;

    setIsCheckingSandboxRuntime(true);
    void getSandboxRuntimeStatus({ projectId, forceRefresh: true })
      .then((result) => {
        if (!cancelled) {
          setSandboxRuntimeStatus(result.status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSandboxRuntimeStatus("unknown");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCheckingSandboxRuntime(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [getSandboxRuntimeStatus, project?.sandboxStatus, projectId]);

  useEffect(() => {
    if (!selectedReasoningEfforts.includes(selectedReasoningEffort)) {
      setSelectedReasoningEffort(DEFAULT_CODEX_REASONING_EFFORT);
    }
  }, [selectedReasoningEffort, selectedReasoningEfforts]);

  const switchBranch = useCallback(async (branch: string) => {
    if (!project || branch === currentBranch) {
      setSelectedBranch(branch);
      return;
    }

    if (openThreads.length > 0) {
      const confirmed = window.confirm("Switching branch affects the sandbox used by new and existing threads.");
      if (!confirmed) {
        setSelectedBranch(currentBranch);
        return;
      }
    }

    setSelectedBranch(branch);
    mutateSwitchBranch(branch);
  }, [currentBranch, openThreads.length, project, mutateSwitchBranch]);

  const quickActions = [
    "Summarize latest changes",
    "Review my latest PR",
    "Suggest a new feature",
    "Create a task for…",
  ];

  return (
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
                        <h1 className="text-lg font-semibold tracking-tight text-foreground">
                          What do you want to work on?
                        </h1>
                        <div className="mt-2 flex flex-wrap items-center justify-center gap-2 font-mono text-[11px] text-muted-foreground/70">
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <GitBranch className="size-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{project.repoFullName ?? "project"}</span>
                          </span>
                          <Select value={selectedBranch} onValueChange={(branch) => branch && void switchBranch(branch)}>
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
                            </SelectContent>
                          </Select>
                          {isSwitchingBranch || project.branchSwitchStatus === "switching" ? (
                            <Loader2 className="size-3 animate-spin text-primary" aria-hidden="true" />
                          ) : null}
                        </div>
                      </div>

                      <form onSubmit={handlePromptSubmit}>
                        <input
                          ref={promptImageInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          disabled={project.sandboxStatus !== "ready" || isCreatingThread}
                          onChange={handlePromptImageInputChange}
                        />
                        <div
                          className={`border bg-background transition-shadow ${isFocused
                            ? "border-primary/40 shadow-[0_0_0_3px_oklch(0.90_0.15_115.6/0.08)]"
                            : "border-border hover:border-border/80"
                            }`}
                        >
                          {promptImages.length > 0 ? (
                            <div className="flex flex-wrap gap-2 px-3.5 pt-3.5">
                              {promptImages.map((image) => (
                                <div
                                  key={image.id}
                                  className="group/image relative size-16 overflow-hidden border border-border bg-muted"
                                >
                                  <img
                                    alt={image.filename}
                                    className="h-full w-full object-cover"
                                    src={image.previewUrl}
                                  />
                                  {image.uploadState.status === "uploading" ? (
                                    <div
                                      aria-label="Image upload in progress"
                                      className="absolute inset-0 grid place-items-center bg-background/70"
                                      role="status"
                                    >
                                      <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
                                    </div>
                                  ) : null}
                                  {image.uploadState.status === "error" ? (
                                    <div
                                      aria-label="Image upload failed"
                                      className="absolute inset-0 grid place-items-center bg-destructive/15 text-destructive"
                                      role="status"
                                      title={image.uploadState.error}
                                    >
                                      <CircleAlert className="size-4" aria-hidden="true" />
                                    </div>
                                  ) : null}
                                  <button
                                    type="button"
                                    aria-label={`Remove ${image.filename}`}
                                    className="absolute right-1 top-1 inline-flex size-5 items-center justify-center border border-border bg-background/90 text-muted-foreground opacity-0 shadow-sm transition hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/image:opacity-100"
                                    disabled={isCreatingThread}
                                    onClick={() => removePromptImage(image.id)}
                                  >
                                    <X className="size-3" aria-hidden="true" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : null}

                          <div className={`px-4 pb-2 ${promptImages.length > 0 ? "pt-2.5" : "pt-3.5"}`}>
                            <textarea
                              ref={textareaRef}
                              value={promptValue}
                              onChange={(e) => setPromptValue(e.target.value)}
                              onPaste={handlePromptPaste}
                              onFocus={() => setIsFocused(true)}
                              onBlur={() => setIsFocused(false)}
                              placeholder={`Ask ${project.repoFullName?.split("/")[1] ?? "the agent"} anything…`}
                              disabled={project.sandboxStatus !== "ready" || isCreatingThread}
                              rows={1}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  void startThread();
                                }
                              }}
                              className="w-full resize-none bg-transparent text-[14px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-50"
                              style={{ minHeight: "24px", maxHeight: "160px" }}
                            />
                          </div>

                          <div className="flex items-center justify-between gap-2 px-3 py-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-1">
                              <button
                                type="button"
                                aria-label="Add photos"
                                title="Add photos"
                                onClick={() => promptImageInputRef.current?.click()}
                                disabled={project.sandboxStatus !== "ready" || isCreatingThread}
                                className="inline-flex size-7 shrink-0 items-center justify-center border border-transparent bg-transparent text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <ImagePlus className="size-3.5" aria-hidden="true" />
                              </button>
                              <span className="inline-flex h-7 shrink-0 items-center px-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                                {CODEX_MODELS[0].label}
                              </span>
                            <Select
                              value={selectedReasoningEffort}
                              onValueChange={(value) => value && setSelectedReasoningEffort(value as CodexReasoningEffort)}
                            >
                              <SelectTrigger
                                size="sm"
                                className="h-7 max-w-[170px] border-transparent bg-transparent px-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:bg-muted hover:text-foreground"
                                disabled={project.sandboxStatus !== "ready" || isCreatingThread}
                                aria-label="Reasoning level"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent align="start" alignItemWithTrigger={false} side="top" className="min-w-44">
                                {selectedReasoningEfforts.map((effort) => (
                                  <SelectItem key={effort} value={effort}>
                                    {effort === "xhigh" ? "Extra high" : effort.charAt(0).toUpperCase() + effort.slice(1)} reasoning
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={demoEnabled}
                              onClick={() => setDemoEnabled((enabled) => !enabled)}
                              disabled={project.sandboxStatus !== "ready" || isCreatingThread}
                              title={demoEnabled ? "Demo enabled for new threads" : "Allow the agent to record a demo for new threads"}
                              className={`inline-flex h-7 shrink-0 items-center gap-1.5 border px-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition disabled:cursor-not-allowed disabled:opacity-40 ${
                                demoEnabled
                                  ? "border-primary/35 bg-primary/10 text-primary hover:bg-primary/15"
                                  : "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                              }`}
                            >
                              <Video className="size-3.5" aria-hidden="true" />
                              <span>Demo</span>
                            </button>
                            </div>
                            <button
                              type="submit"
                              disabled={project.sandboxStatus !== "ready" || isCreatingThread}
                              className="inline-flex size-7 items-center justify-center bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <ArrowUp className="size-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </form>

                      <div className="mt-3 flex justify-center">
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
                            disabled={project.sandboxStatus !== "ready"}
                            className="border border-border/60 px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {action}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {project.sandboxStatus === "creating" ? (
                    <div className="mx-auto w-full max-w-[600px] px-5">
                      <div className="border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-700 dark:text-amber-300">
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
                      <div className="border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-700 dark:text-amber-300">
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
                        <label className="flex h-8 w-44 items-center gap-1.5 border border-border/60 bg-background px-2.5 text-xs text-muted-foreground transition-colors focus-within:border-primary/30">
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
                          disabled={project.sandboxStatus !== "ready" || isCreatingThread}
                          className="inline-flex h-8 items-center gap-1.5 border border-primary/20 bg-primary/6 px-2.5 font-mono text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <MessageSquarePlus className="size-3" aria-hidden="true" />
                          New
                        </button>
                      </div>
                    </div>

                    <div className="divide-y divide-border/60 border border-border/60 bg-background">
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
  );
}

export const Route = createFileRoute("/project/$projectId/")({ component: ProjectOverviewPage });
