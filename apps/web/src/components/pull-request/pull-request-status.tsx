import { cn } from "@autopr/ui/lib/utils";
import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";

const STATES = {
  open: { label: "Open", Icon: GitPullRequest, tone: "text-emerald-400" },
  closed: { label: "Closed", Icon: GitPullRequestClosed, tone: "text-red-400" },
  merged: { label: "Merged", Icon: GitMerge, tone: "text-violet-400" },
  draft: { label: "Draft", Icon: GitPullRequestDraft, tone: "text-muted-foreground" },
  unknown: { label: "Pull request", Icon: GitPullRequest, tone: "text-muted-foreground" },
};

export function PullRequestStatus({ state, number, showLabel = false, className }: {
  state: keyof typeof STATES;
  number?: number;
  showLabel?: boolean;
  className?: string;
}) {
  const { label, Icon, tone } = STATES[state];
  return (
    <span title={label} className={cn("inline-flex shrink-0 items-center gap-1.5", tone, className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className={showLabel ? undefined : "sr-only"}>{label}</span>
      {number !== undefined ? <span className="font-mono tabular-nums">#{number}</span> : null}
    </span>
  );
}
