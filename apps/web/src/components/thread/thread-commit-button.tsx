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
import { AlertTriangle, CheckCircle2, GitCommitHorizontal, Loader2, UploadCloud } from "lucide-react";
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

function shortSha(value: string | undefined) {
  return value ? value.slice(0, 7) : undefined;
}

export function ThreadCommitButton({ projectId, threadId, disabled = false }: ThreadCommitButtonProps) {
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
  const busy = commitMutation.isPending;
  const pendingAction = busy ? commitMutation.variables?.action ?? null : null;
  const result = commitMutation.data ?? null;
  const error = commitMutation.error?.message ?? null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              aria-label="Commit and push changes"
              onClick={() => {
                setOpen(true);
                commitMutation.reset();
              }}
              className="my-1.5 mr-2 h-8 gap-1.5 border-border bg-background px-3 text-foreground hover:bg-muted"
            >
              <GitCommitHorizontal className="size-3.5" aria-hidden />
              Commit & push
            </Button>
          }
        />
        <TooltipContent side="bottom" sideOffset={8}>
          Commit or push changes
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={(nextOpen) => !busy && setOpen(nextOpen)}>
        <DialogContent className="gap-4 border-border bg-background p-0 sm:max-w-sm" showCloseButton={!busy}>
          <DialogHeader className="border-b border-border px-4 py-3">
            <DialogTitle>Commit changes</DialogTitle>
            <DialogDescription>
              Choose whether to commit locally or push to the current branch.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 px-4">
            {result ? (
              <div className="flex gap-2 border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">
                    {result.status === "pushed" ? "Committed and pushed" : "Committed"}{" "}
                    {shortSha(result.commitSha) ? <span className="font-mono">{shortSha(result.commitSha)}</span> : null}
                  </p>
                  <p className="break-words text-emerald-700/80 dark:text-emerald-300/80">
                    {result.commitMessage}
                  </p>
                  {result.branch ? (
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-700/60 dark:text-emerald-300/60">
                      {result.branch}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="flex gap-2 border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p className="min-w-0 break-words">{error}</p>
              </div>
            ) : null}
          </div>

          <DialogFooter className="flex-row justify-end gap-2 px-4 pb-4">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => commitMutation.mutate({ action: "commit" })}
            >
              {pendingAction === "commit" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <GitCommitHorizontal className="size-3.5" aria-hidden />}
              Just commit
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => commitMutation.mutate({ action: "push" })}
            >
              {pendingAction === "push" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <UploadCloud className="size-3.5" aria-hidden />}
              Commit & push
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
