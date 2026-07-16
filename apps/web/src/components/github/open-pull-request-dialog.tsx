import { api } from "@autopr/backend/convex/_generated/api";
import { isThreadCompatibleWithGithubPullRequest } from "@autopr/backend/convex/lib/githubPullRequest";
import { Button } from "@autopr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@autopr/ui/components/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@autopr/ui/components/select";
import { useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { ExternalLink, GitFork, GitPullRequest, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type PullRequestPreview = {
  number: number;
  title: string;
  author: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  htmlUrl: string;
  head: {
    repositoryFullName: string;
    branch: string;
    sha: string;
    branchAvailable: boolean;
    canPush: boolean;
  };
  base: { repositoryFullName: string; branch: string };
  isFork: boolean;
};

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data ? String(data.error) : "Request failed.";
    throw new Error(message);
  }
  return data as T;
}

export function OpenGithubPullRequestDialog({
  projectId,
  open,
  onOpenChange,
  initialReference = "",
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialReference?: string;
}) {
  const navigate = useNavigate();
  const { isAuthenticated } = useConvexAuth();
  const threads = useQuery(api.threads.listByProject, open && isAuthenticated ? { projectId } : "skip");
  const [reference, setReference] = useState(initialReference);
  const [preview, setPreview] = useState<PullRequestPreview>();
  const [mode, setMode] = useState<"create" | "attach">("create");
  const [threadId, setThreadId] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setReference(initialReference);
    setPreview(undefined);
    setMode("create");
    setThreadId("");
    setError(undefined);
  }, [initialReference, open]);

  const compatibleThreads = useMemo(
    () => threads?.filter(isThreadCompatibleWithGithubPullRequest) ?? [],
    [threads],
  );

  const resolve = async () => {
    setIsResolving(true);
    setError(undefined);
    try {
      const result = await readJson<{ pullRequest: PullRequestPreview }>(await fetch(
        `/api/project/${encodeURIComponent(projectId)}/pulls`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resolve", reference }),
        },
      ));
      setPreview(result.pullRequest);
    } catch (resolveError) {
      setPreview(undefined);
      setError(resolveError instanceof Error ? resolveError.message : "Could not resolve the pull request.");
    } finally {
      setIsResolving(false);
    }
  };

  const openPullRequest = async () => {
    if (!preview) return;
    setIsOpening(true);
    setError(undefined);
    try {
      const result = await readJson<{ threadId: string }>(await fetch(
        `/api/project/${encodeURIComponent(projectId)}/pulls`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: mode, reference, threadId: mode === "attach" ? threadId : undefined }),
        },
      ));
      onOpenChange(false);
      await navigate({
        to: "/project/$projectId/thread/$threadId",
        params: { projectId, threadId: result.threadId },
      });
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Could not open the pull request.");
    } finally {
      setIsOpening(false);
    }
  };

  const unavailableReason = preview?.state !== "open"
    ? `This pull request is ${preview?.state}. Only open pull requests can be opened.`
    : preview && !preview.head.branchAvailable
      ? "The pull request source branch was deleted or is unavailable."
      : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Open GitHub PR in AutoPR</DialogTitle>
          <DialogDescription>
            Paste a PR URL, number, or <code>gh pr checkout</code> command.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void resolve();
            }}
          >
            <input
              value={reference}
              onChange={(event) => {
                setReference(event.target.value);
                setPreview(undefined);
              }}
              placeholder="https://github.com/owner/repo/pull/123"
              aria-label="GitHub pull request reference"
              className="h-9 min-w-0 flex-1 rounded-sm border border-border bg-background px-3 font-mono text-xs outline-none focus:border-ring"
              autoFocus
            />
            <Button type="submit" variant="outline" disabled={!reference.trim() || isResolving || isOpening}>
              {isResolving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : "Preview"}
            </Button>
          </form>

          {preview ? (
            <div className="rounded-sm border border-border bg-muted/20 p-4">
              <div className="flex items-start gap-3">
                {preview.isFork ? <GitFork className="mt-0.5 size-4 text-muted-foreground" /> : <GitPullRequest className="mt-0.5 size-4 text-primary" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">#{preview.number}</span>
                    <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase">{preview.state}</span>
                    {preview.draft ? <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase">draft</span> : null}
                  </div>
                  <p className="mt-2 text-sm font-medium text-foreground">{preview.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">by {preview.author}</p>
                </div>
                <a href={preview.htmlUrl} target="_blank" rel="noreferrer" aria-label="View pull request on GitHub" className="text-muted-foreground hover:text-foreground">
                  <ExternalLink className="size-4" />
                </a>
              </div>
              <dl className="mt-4 grid gap-3 border-t border-border pt-3 text-xs sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">head</dt>
                  <dd className="mt-1 truncate font-mono">{preview.head.repositoryFullName}:{preview.head.branch}</dd>
                  <dd className="mt-0.5 font-mono text-[10px] text-muted-foreground">{preview.head.sha.slice(0, 12)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">base</dt>
                  <dd className="mt-1 truncate font-mono">{preview.base.repositoryFullName}:{preview.base.branch}</dd>
                  <dd className="mt-0.5 text-[10px] text-muted-foreground">{preview.isFork ? "fork pull request" : "same repository"}</dd>
                </div>
              </dl>
              {preview.isFork && !preview.head.canPush ? (
                <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                  You can work locally, but GitHub has not granted this account permission to push to the fork branch.
                </p>
              ) : null}
            </div>
          ) : null}

          {preview && !unavailableReason ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={mode === "create" ? "default" : "outline"} onClick={() => setMode("create")}>Create new thread</Button>
                <Button type="button" variant={mode === "attach" ? "default" : "outline"} onClick={() => setMode("attach")} disabled={compatibleThreads.length === 0}>Attach to thread</Button>
              </div>
              {mode === "attach" ? (
                <Select value={threadId} onValueChange={(value) => setThreadId(value ?? "")}>
                  <SelectTrigger><SelectValue placeholder="Select a compatible thread" /></SelectTrigger>
                  <SelectContent>
                    {compatibleThreads.map((thread) => <SelectItem key={thread.threadId} value={thread.threadId}>{thread.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          ) : null}

          {unavailableReason ? <p className="rounded-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{unavailableReason}</p> : null}
          {error ? <p className="rounded-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isOpening}>Cancel</Button>
          <Button type="button" onClick={() => void openPullRequest()} disabled={!preview || Boolean(unavailableReason) || isOpening || (mode === "attach" && !threadId)}>
            {isOpening ? <><Loader2 className="size-4 animate-spin" aria-hidden="true" />Preparing worktree…</> : mode === "attach" ? "Attach PR" : "Create thread"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
