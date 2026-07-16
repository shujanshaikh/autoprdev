import type { ThreadGitStatus } from "@autopr/backend/convex/lib/gitStatus";
import { api } from "@autopr/backend/convex/_generated/api";
import { Button } from "@autopr/ui/components/button";
import { ButtonGroup } from "@autopr/ui/components/button-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@autopr/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@autopr/ui/components/dropdown-menu";
import { Textarea } from "@autopr/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Loader2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ThreadGitOperationProgress } from "#/components/thread/thread-git-operation-progress";

import {
  resolveThreadGitActions,
  threadGitActionLabels,
  threadGitActions,
  type ThreadGitAction,
} from "#/lib/thread-git-actions";
import {
  threadGitStatusQueryKey,
  useThreadGitStatusQuery,
} from "#/lib/thread-git-status-query";

interface ThreadCommitButtonProps {
  projectId: string;
  threadId: string;
  disabled?: boolean;
}

type GitActionVariables = {
  action: Exclude<ThreadGitAction, "view_pr">;
  operationId?: string;
  commitMessage?: string;
};

type GitActionResponse = {
  operationId?: string;
  status?: "committed" | "pushed" | "updated" | "created" | "running" | "succeeded" | "failed";
  branch?: string;
  commitSha?: string;
  commitMessage?: string;
  url?: string;
  number?: number;
  error?: string | { code?: string; message?: string };
};

type ThreadCommitState = {
  gitStatus?: ThreadGitStatus;
};

const actionIcons = {
  commit: GitCommitHorizontal,
  commit_push: ArrowUpRight,
  push: Upload,
  pull: ArrowDownToLine,
  create_pr: GitPullRequest,
  push_create_pr: GitPullRequest,
  commit_push_create_pr: GitPullRequest,
  view_pr: ExternalLink,
} satisfies Record<ThreadGitAction, typeof GitBranch>;

const pendingLabels: Record<GitActionVariables["action"], string> = {
  commit: "Committing changes…",
  commit_push: "Committing and pushing changes…",
  push: "Pushing local commits…",
  pull: "Updating branch…",
  create_pr: "Creating the pull request…",
  push_create_pr: "Pushing and creating the pull request…",
  commit_push_create_pr: "Committing, pushing, and creating the pull request…",
};

const successLabels: Record<NonNullable<GitActionResponse["status"]>, string> = {
  committed: "Changes committed",
  pushed: "Branch pushed",
  updated: "Branch updated",
  created: "Pull request created",
  running: "Git operation running",
  succeeded: "Git operation completed",
  failed: "Git operation failed",
};

function shortSha(value: string | undefined) {
  return value ? value.slice(0, 7) : undefined;
}

export function ThreadCommitButton({
  projectId,
  threadId,
  disabled = false,
  thread,
}: ThreadCommitButtonProps & { thread?: ThreadCommitState | null }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogAction, setDialogAction] = useState<Exclude<ThreadGitAction, "view_pr"> | null>(null);
  const [commitMessageDraft, setCommitMessageDraft] = useState("");
  const [activeOperationId, setActiveOperationId] = useState<string>();
  const presentedOperationId = useRef<string>();
  const queryClient = useQueryClient();
  const gitStatusQuery = useThreadGitStatusQuery({
    projectId,
    threadId,
    persistedStatus: thread?.gitStatus,
    refetchInterval: false,
  });
  const status = gitStatusQuery.data ?? thread?.gitStatus;
  const resolution = useMemo(() => resolveThreadGitActions(status), [status]);
  const statusQueryKey = threadGitStatusQueryKey(projectId, threadId);
  const latestOperation = useQuery(api.threads.getLatestGitOperation, { threadId });
  const activeOperation = latestOperation && (
    latestOperation.operationId === activeOperationId ||
    (!activeOperationId && latestOperation.status !== "succeeded")
  ) ? latestOperation : undefined;

  useEffect(() => {
    if (!activeOperation || presentedOperationId.current === activeOperation.operationId) return;
    presentedOperationId.current = activeOperation.operationId;
    setActiveOperationId(activeOperation.operationId);
    setDialogAction(activeOperation.requestedAction);
    if (!dialogOpen) setDialogOpen(true);
  }, [activeOperation, dialogOpen]);

  const mutation = useMutation<GitActionResponse, Error, GitActionVariables>({
    mutationKey: ["thread", projectId, threadId, "git-mutation"],
    mutationFn: async ({ action, commitMessage, operationId }) => {
      const response = await fetch(
        `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, commitMessage, operationId }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as GitActionResponse;
      if (!response.ok) {
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : body.error?.message || "Could not complete the Git operation.",
        );
      }
      return body;
    },
    onSuccess: () => {
      setCommitMessageDraft("");
    },
    onSettled: async () => {
      await queryClient.refetchQueries({ queryKey: statusQueryKey, exact: true, type: "active" });
    },
  });

  const busy = mutation.isPending || activeOperation?.status === "running";
  const activeAction = busy ? mutation.variables?.action ?? dialogAction : dialogAction;
  const result = mutation.data;
  const error = mutation.error?.message;
  const isCommitDialog = dialogAction === "commit" || dialogAction === "commit_push";

  const runAction = (action: ThreadGitAction) => {
    const availability = resolution.actions[action];
    if (disabled || busy || !availability.enabled) return;

    mutation.reset();
    if (action === "view_pr") {
      const url = status?.pullRequest?.url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    setDialogAction(action);
    setDialogOpen(true);
    if (action !== "commit" && action !== "commit_push") {
      const operationId = crypto.randomUUID();
      setActiveOperationId(operationId);
      mutation.mutate({ action, operationId });
    }
  };

  const submitCommit = () => {
    if (!dialogAction || (dialogAction !== "commit" && dialogAction !== "commit_push")) return;
    const commitMessage = commitMessageDraft.trim();
    mutation.reset();
    const operationId = crypto.randomUUID();
    setActiveOperationId(operationId);
    mutation.mutate({
      action: dialogAction,
      operationId,
      commitMessage: commitMessage || undefined,
    });
  };

  const retryOperation = () => {
    if (!activeOperation) return;
    mutation.reset();
    mutation.mutate({
      action: activeOperation.requestedAction,
      operationId: activeOperation.operationId,
      commitMessage: activeOperation.commitMessage,
    });
  };

  const primaryAvailability = resolution.primaryAction
    ? resolution.actions[resolution.primaryAction]
    : { enabled: false, reason: resolution.primaryReason };
  const primaryDisabled = disabled || busy || !primaryAvailability.enabled;
  const PrimaryIcon = resolution.primaryAction ? actionIcons[resolution.primaryAction] : GitBranch;
  const primaryTitle = disabled
    ? "Git actions are unavailable while this thread is loading."
    : primaryAvailability.reason || resolution.primaryLabel;

  return (
    <>
      <ButtonGroup className="mr-2 h-8 self-center">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={primaryDisabled}
          aria-label={busy && activeAction ? pendingLabels[activeAction] : resolution.primaryLabel}
          title={primaryTitle}
          onClick={() => resolution.primaryAction && runAction(resolution.primaryAction)}
          className="h-8 gap-1.5 border-border bg-background px-3 text-foreground hover:bg-muted"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <PrimaryIcon className="size-3.5" aria-hidden />
          )}
          {busy && activeAction ? pendingLabels[activeAction] : resolution.primaryLabel}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                disabled={disabled || busy}
                aria-label="Choose Git action"
                title="Choose a Git action"
                className="h-8 border-border bg-background text-foreground hover:bg-muted"
              >
                <ChevronDown className="size-3" aria-hidden />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-72">
            {threadGitActions.map((action) => {
              const availability = resolution.actions[action];
              const ActionIcon = actionIcons[action];
              return (
                <DropdownMenuItem
                  key={action}
                  disabled={!availability.enabled}
                  title={availability.reason}
                  onClick={() => runAction(action)}
                  className="items-start py-2.5"
                >
                  <ActionIcon className="mt-0.5 size-3.5" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm">{threadGitActionLabels[action]}</span>
                    {availability.reason ? (
                      <span className="mt-0.5 block whitespace-normal text-[11px] leading-snug text-muted-foreground">
                        {availability.reason}
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>

      <Dialog open={dialogOpen} onOpenChange={(open) => !busy && setDialogOpen(open)}>
        <DialogContent className="gap-0 border-border bg-background p-0 sm:max-w-[420px]" showCloseButton={!busy}>
          <DialogHeader className="border-b border-border px-5 pb-3 pt-4">
            <DialogTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
              {activeAction ? (() => {
                const DialogIcon = actionIcons[activeAction];
                return <DialogIcon className="size-4 text-primary" aria-hidden />;
              })() : null}
              {activeAction ? threadGitActionLabels[activeAction] : "Git action"}
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs text-muted-foreground">
              {isCommitDialog
                ? "Add an optional commit message, or leave it blank to generate one."
                : activeAction
                  ? pendingLabels[activeAction]
                  : "Manage this thread branch."}
            </DialogDescription>
          </DialogHeader>

          <div className="px-5 py-4" aria-live="polite">
            {isCommitDialog && !busy && !result ? (
              <Textarea
                aria-label="Commit message"
                value={commitMessageDraft}
                maxLength={500}
                rows={4}
                placeholder="Commit message (leave blank to generate)…"
                onChange={(event) => setCommitMessageDraft(event.target.value)}
                className="min-h-24 resize-none bg-muted/20 text-sm leading-relaxed placeholder:text-muted-foreground/75"
              />
            ) : null}

            {activeOperation ? (
              <ThreadGitOperationProgress
                operation={activeOperation}
                retrying={mutation.isPending}
                onRetry={retryOperation}
              />
            ) : busy && activeAction ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {pendingLabels[activeAction]}
              </div>
            ) : null}

            {result && !activeOperation ? (
              <div className="relative overflow-hidden border border-primary/20 bg-primary/[0.04]" role="status">
                <div className="absolute inset-y-0 left-0 w-[3px] bg-primary" />
                <div className="py-3 pl-5 pr-4">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Check className="size-3.5 text-primary" aria-hidden />
                    {result.status ? successLabels[result.status] : "Git operation completed"}
                  </p>
                  {result.commitMessage ? (
                    <p className="mt-1.5 break-words text-xs leading-relaxed text-muted-foreground">
                      {result.commitMessage}
                    </p>
                  ) : null}
                  <div className="mt-3 flex items-center gap-3">
                    {shortSha(result.commitSha) ? (
                      <span className="border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-foreground">
                        {shortSha(result.commitSha)}
                      </span>
                    ) : null}
                    {result.branch ? (
                      <span className="inline-flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                        <GitBranch className="size-2.5 shrink-0" aria-hidden />
                        <span className="truncate font-mono uppercase tracking-wider">{result.branch}</span>
                      </span>
                    ) : null}
                    {result.url ? (
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                      >
                        PR #{result.number}
                        <ExternalLink className="size-2.5" aria-hidden />
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {error && !activeOperation ? (
              <div className="relative overflow-hidden border border-destructive/20 bg-destructive/[0.04]" role="alert">
                <div className="absolute inset-y-0 left-0 w-[3px] bg-destructive" />
                <div className="flex gap-2.5 py-3 pl-5 pr-4">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
                  <p className="min-w-0 break-words text-xs leading-relaxed text-destructive">{error}</p>
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-border px-5 py-3">
            {result ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
                Close
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setDialogOpen(false)}
                >
                  {busy ? "Working…" : "Cancel"}
                </Button>
                {isCommitDialog ? (
                  <Button type="button" size="sm" disabled={busy} onClick={submitCommit}>
                    {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                    {dialogAction === "commit_push" ? "Commit & push" : "Commit"}
                  </Button>
                ) : null}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
