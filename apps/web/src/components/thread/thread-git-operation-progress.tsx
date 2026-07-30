import type { Doc } from "@autopr/backend/convex/_generated/dataModel";
import type { GitWorkflowPhase } from "@autopr/backend/convex/lib/gitWorkflow";
import { phasesForGitWorkflowAction } from "@autopr/backend/convex/lib/gitWorkflow";
import { Button } from "@autopr/ui/components/button";
import { cn } from "@autopr/ui/lib/utils";
import { AlertTriangle, Check, Circle, Loader2, RotateCcw } from "lucide-react";

import { GitHubLogo } from "#/components/icons/github-logo";

type GitOperation = Doc<"gitOperations">;

const phaseLabels: Record<GitWorkflowPhase, string> = {
  branch: "Created branch",
  validate: "Running validation/hooks",
  commit: "Committed files",
  push: "Pushed to GitHub",
  pull_request: "Created pull request",
};

export function ThreadGitOperationProgress({
  operation,
  retrying = false,
  onRetry,
}: {
  operation: GitOperation;
  retrying?: boolean;
  onRetry?: () => void;
}) {
  const results = new Map(operation.phaseResults.map((result) => [result.phase, result]));
  const phases = phasesForGitWorkflowAction(operation.requestedAction);

  return (
    <div className="space-y-3" aria-live="polite">
      <ol className="space-y-2" aria-label="Git operation progress">
        {phases.map((phase) => {
          const result = results.get(phase);
          const running = operation.status === "running" && operation.currentPhase === phase;
          const failed = result?.status === "failed";
          const complete = result?.status === "succeeded" || result?.status === "skipped";
          const Icon = phase === "push" && complete
            ? GitHubLogo
            : running
              ? Loader2
              : failed
                ? AlertTriangle
                : complete
                  ? Check
                  : Circle;
          return (
            <li key={phase} className="flex items-start gap-2.5 text-xs">
              <Icon
                className={cn(
                  "mt-0.5 size-3.5 shrink-0",
                  running && "animate-spin text-primary",
                  failed && "text-destructive",
                  complete && "text-primary",
                  !running && !failed && !complete && "text-muted-foreground/45",
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className={cn(
                  "leading-4",
                  failed ? "text-destructive" : complete || running ? "text-foreground" : "text-muted-foreground/60",
                )}>
                  {result?.summary ?? phaseLabels[phase]}
                </p>
                {failed && result.failure?.diagnostics ? (
                  <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words border border-destructive/20 bg-destructive/[0.04] p-2 font-mono text-[10px] leading-relaxed text-destructive/90">
                    {result.failure.diagnostics}
                  </pre>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {operation.status === "failed" && operation.failure ? (
        <div className="border border-destructive/30 bg-destructive/[0.04] p-3 text-xs" role="alert">
          <p className="font-medium text-destructive">{operation.failure.message}</p>
          {operation.failure.recoveryAction ? (
            <p className="mt-1 leading-relaxed text-muted-foreground">{operation.failure.recoveryAction}</p>
          ) : null}
          {operation.failure.retryable && onRetry ? (
            <Button type="button" variant="outline" size="sm" className="mt-3 h-7 gap-1.5 text-xs" disabled={retrying} onClick={onRetry}>
              {retrying ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <RotateCcw className="size-3" aria-hidden />}
              Retry from {operation.failure.phase.replace("_", " ")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
