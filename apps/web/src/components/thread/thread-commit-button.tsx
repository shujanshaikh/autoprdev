import { Button } from "@autopr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@autopr/ui/components/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@autopr/ui/components/tooltip";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, GitCommitHorizontal, GitBranch, Loader2 } from "lucide-react";
import { useState } from "react";

interface ThreadCommitButtonProps {
  projectId: string;
  threadId: string;
  disabled?: boolean;
}

type CommitAction = "commit" | "push";

type CommitVariables = {
  action: CommitAction;
};

type CommitResponse = {
  status?: "committed" | "pushed";
  branch?: string;
  commitSha?: string;
  commitMessage?: string;
  error?: string;
};

type ThreadCommitState = {
  commitStatus?: "committed" | "pushed";
  commitBranch?: string;
  commitSha?: string;
  commitMessage?: string;
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
  const commitMutation = useMutation<CommitResponse, Error, CommitVariables>({
    mutationKey: ["thread", projectId, threadId, "commit"],
    mutationFn: async ({ action }) => {
      const response = await fetch(
        `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "commit", push: action === "push" }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as CommitResponse;

      if (!response.ok) {
        throw new Error(body.error || "Could not commit changes.");
      }

      return body;
    },
  });
  const savedResult: CommitResponse | null = thread?.commitStatus
    ? {
      status: thread.commitStatus,
      branch: thread.commitBranch,
      commitSha: thread.commitSha,
      commitMessage: thread.commitMessage,
    }
    : null;
  const busy = commitMutation.isPending;
  const pendingAction = busy ? commitMutation.variables?.action ?? null : null;
  const result = commitMutation.data ?? savedResult;
  const error = commitMutation.error?.message ?? null;
  const hasCompletedCommit = Boolean(result?.status);
  const buttonDisabled = disabled || busy || hasCompletedCommit;
  const buttonLabel = result?.status === "pushed"
    ? "Committed & pushed"
    : result?.status === "committed"
      ? "Committed"
      : "Commit & push";

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={buttonDisabled}
              aria-label={buttonLabel}
              onClick={() => {
                setOpen(true);
                commitMutation.reset();
              }}
              className="my-1.5 mr-2 h-8 gap-1.5 border-border bg-background px-3 text-foreground hover:bg-muted"
            >
              <GitCommitHorizontal className="size-3.5" aria-hidden />
              {buttonLabel}
            </Button>
          }
        />
        <TooltipContent side="bottom" sideOffset={8}>
          {hasCompletedCommit ? "This thread has already been committed" : "Commit or push changes"}
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={(nextOpen) => !busy && setOpen(nextOpen)}>
        <DialogContent className="gap-0 border-border bg-background p-0 sm:max-w-[400px]" showCloseButton={!busy}>
          {/* Header */}
          <DialogHeader className="border-b border-border px-5 pb-3 pt-4">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
              <GitCommitHorizontal className="size-4 text-primary" aria-hidden />
              Commit changes
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs text-muted-foreground">
              Choose whether to commit locally or push to the current branch.
            </DialogDescription>
          </DialogHeader>

          {/* Body */}
          <div className="px-5 py-4">
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
                    <p className="text-xs font-semibold tracking-tight text-foreground">
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || hasCompletedCommit}
              onClick={() => commitMutation.mutate({ action: "commit" })}
              className="gap-1.5"
            >
              {pendingAction === "commit" ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : (
                <GitCommitHorizontal className="size-3" aria-hidden />
              )}
              Just commit
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || hasCompletedCommit}
              onClick={() => commitMutation.mutate({ action: "push" })}
              className="gap-1.5"
            >
              {pendingAction === "push" ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : (
                <ArrowUpRight className="size-3" aria-hidden />
              )}
              Commit & push
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
