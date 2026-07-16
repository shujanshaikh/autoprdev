import type { ThreadGitStatus } from "@autopr/backend/convex/lib/gitStatus";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@autopr/ui/components/dropdown-menu";
import { Textarea } from "@autopr/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, ChevronDown, GitCommitHorizontal, GitBranch, Loader2 } from "lucide-react";
import { useState } from "react";

interface ThreadCommitButtonProps {
  projectId: string;
  threadId: string;
  disabled?: boolean;
}

type CommitAction = "commit" | "push";

type CommitVariables = {
  action: CommitAction;
  commitMessage?: string;
};

type CommitResponse = {
  status?: "committed" | "pushed";
  branch?: string;
  commitSha?: string;
  commitMessage?: string;
  error?: string;
  projectId?: string;
  threadId?: string;
};

type ThreadCommitState = {
  gitStatus?: ThreadGitStatus;
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
  const [open, setOpen] = useState(false);
  const [commitMessageDraft, setCommitMessageDraft] = useState("");
  const queryClient = useQueryClient();
  const commitMutation = useMutation<CommitResponse, Error, CommitVariables>({
    mutationKey: ["thread", projectId, threadId, "commit"],
    mutationFn: async ({ action, commitMessage }) => {
      const response = await fetch(
        `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "commit",
            push: action === "push",
            commitMessage,
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as CommitResponse;

      if (!response.ok) {
        if (response.status === 409 && body.status) {
          return { ...body, projectId, threadId };
        }

        throw new Error(body.error || "Could not commit changes.");
      }

      return { ...body, projectId, threadId };
    },
    onSuccess: () => {
      setCommitMessageDraft("");
      void queryClient.invalidateQueries({ queryKey: ["thread", projectId, threadId, "git-status"] });
    },
  });

  const busy = commitMutation.isPending;
  const pendingAction = busy ? commitMutation.variables?.action ?? null : null;
  const localResult =
    commitMutation.data?.projectId === projectId && commitMutation.data.threadId === threadId
      ? commitMutation.data
      : null;
  const result = localResult;
  const error = commitMutation.error?.message ?? null;
  const hasWorkingChanges = thread?.gitStatus?.hasWorkingTreeChanges ?? true;
  const hasPushableCommits = (thread?.gitStatus?.aheadCount ?? 0) > 0 || (
    !thread?.gitStatus?.hasUpstream && (thread?.gitStatus?.aheadOfBaseCount ?? 0) > 0
  );
  const buttonDisabled = disabled || busy || (!hasWorkingChanges && !hasPushableCommits);
  const buttonLabel = busy
    ? pendingAction === "push"
      ? "Committing & pushing..."
      : "Committing..."
    : hasWorkingChanges
      ? "Commit"
      : "Push";
  const buttonTitle = busy
    ? pendingAction === "push"
      ? "Committing and pushing changes..."
      : "Committing changes..."
    : hasWorkingChanges
      ? "Commit or push changes"
      : "Push local commits";

  const openCommitDialog = () => {
    setOpen(true);
    commitMutation.reset();
  };

  const runCommitAction = (action: CommitAction) => {
    const commitMessage = commitMessageDraft.trim();

    commitMutation.reset();
    commitMutation.mutate({
      action,
      commitMessage: commitMessage || undefined,
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={buttonDisabled}
              aria-label={buttonLabel}
              title={buttonTitle}
              className="mr-2 h-8 self-center gap-1.5 border-border bg-background px-3 text-foreground hover:bg-muted"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <GitCommitHorizontal className="size-3.5" aria-hidden />
              )}
              {buttonLabel}
              <ChevronDown className="size-3" aria-hidden />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem disabled={buttonDisabled || !hasWorkingChanges} onClick={openCommitDialog}>
            <GitCommitHorizontal className="size-3.5" aria-hidden />
            Commit
          </DropdownMenuItem>
          <DropdownMenuItem disabled={buttonDisabled} onClick={openCommitDialog}>
            <ArrowUpRight className="size-3.5" aria-hidden />
            Commit & push
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={(nextOpen) => !busy && setOpen(nextOpen)}>
        <DialogContent className="gap-0 border-border bg-background p-0 sm:max-w-[400px]" showCloseButton={!busy}>
          {/* Header */}
          <DialogHeader className="border-b border-border px-5 pb-3 pt-4">
            <DialogTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
              <GitCommitHorizontal className="size-4 text-primary" aria-hidden />
              Commit changes
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs text-muted-foreground">
              Choose whether to commit locally or push to the current branch.
            </DialogDescription>
          </DialogHeader>

          {/* Body */}
          <div className="px-5 py-4">
            {!result && hasWorkingChanges ? (
              <div className="mb-3">
                <Textarea
                  aria-label="Commit message"
                  value={commitMessageDraft}
                  disabled={busy}
                  maxLength={500}
                  rows={4}
                  placeholder="Commit message (leave blank to generate)..."
                  onChange={(event) => setCommitMessageDraft(event.target.value)}
                  className="min-h-24 resize-none bg-muted/20 text-sm leading-relaxed placeholder:text-muted-foreground/75"
                />
              </div>
            ) : null}

            {busy ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {pendingAction === "push" ? "Committing and pushing changes..." : "Committing changes..."}
              </div>
            ) : null}

            {result ? (
              <div
                className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
              >
                {/* Success card */}
                <div className="relative overflow-hidden border border-primary/20 bg-primary/[0.04]">
                  {/* Accent bar */}
                  <div className="absolute inset-y-0 left-0 w-[3px] bg-primary" />

                  <div className="py-3 pl-5 pr-4">
                    {/* Status label */}
                    <p className="text-xs font-medium text-foreground">
                      {result.status === "pushed" ? "Committed and pushed" : "Committed"}
                    </p>

                    {/* Commit message */}
                    {result.commitMessage ? (
                      <p className="mt-1.5 break-words text-xs leading-relaxed text-muted-foreground">
                        {result.commitMessage}
                      </p>
                    ) : null}

                    {/* Meta row: sha + branch */}
                    <div className="mt-3 flex items-center gap-3">
                      {shortSha(result.commitSha) ? (
                        <span className="inline-flex items-center gap-1 border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-foreground">
                          {shortSha(result.commitSha)}
                        </span>
                      ) : null}
                      {result.branch ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <GitBranch className="size-2.5" aria-hidden />
                          <span className="font-mono uppercase tracking-wider">{result.branch}</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {error ? (
              <div
                className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
              >
                <div className="relative overflow-hidden border border-destructive/20 bg-destructive/[0.04]">
                  <div className="absolute inset-y-0 left-0 w-[3px] bg-destructive" />
                  <div className="flex gap-2.5 py-3 pl-5 pr-4">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
                    <p className="min-w-0 break-words text-xs leading-relaxed text-destructive">{error}</p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Footer */}
          <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-border px-5 py-3">
            {result ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                {hasWorkingChanges ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => runCommitAction("commit")}
                  >
                    <GitCommitHorizontal className="size-3.5" aria-hidden />
                    Commit
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => runCommitAction("push")}
                >
                  <ArrowUpRight className="size-3.5" aria-hidden />
                  {hasWorkingChanges ? "Commit & push" : "Push"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
