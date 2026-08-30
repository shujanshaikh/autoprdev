import { cn } from "@autopr/ui/lib/utils";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import {
  Check,
  ChevronDown,
  Circle,
  CircleAlert,
  Network,
  X,
} from "lucide-react";
import { useState } from "react";

import { toolSlugFromPart } from "@/components/ai-elements/tool";

export type ThreadSubAgentTask = {
  id: string;
  description: string;
  status: "running" | "completed" | "failed";
};

export type ThreadSubAgentActivity = {
  messageId: string;
  tasks: ThreadSubAgentTask[];
};

function subAgentTaskStatus(state: string): ThreadSubAgentTask["status"] {
  if (state === "output-available") return "completed";
  if (state === "output-error" || state === "output-denied") return "failed";
  return "running";
}

function subAgentDescription(input: unknown) {
  if (
    typeof input === "object" &&
    input !== null &&
    "description" in input &&
    typeof input.description === "string" &&
    input.description.trim()
  ) {
    return input.description.trim();
  }

  return "Starting sub-agent";
}

/** Returns sub-agent calls from the latest assistant turn only. */
export function latestSubAgentActivity(
  messages: readonly UIMessage[],
): ThreadSubAgentActivity | undefined {
  const latestAssistant = messages.findLast((message) => message.role === "assistant");
  if (!latestAssistant) return undefined;

  const tasks = latestAssistant.parts.flatMap((part, index) => {
    if (!isToolUIPart(part)) return [];

    const toolName = part.type === "dynamic-tool" ? getToolName(part) : undefined;
    if (toolSlugFromPart(part.type, toolName) !== "sub-agent") return [];

    return [{
      id: "toolCallId" in part
        ? part.toolCallId
        : `${latestAssistant.id}:${index}`,
      description: subAgentDescription("input" in part ? part.input : undefined),
      status: subAgentTaskStatus(part.state),
    } satisfies ThreadSubAgentTask];
  });

  return tasks.length > 0
    ? { messageId: latestAssistant.id, tasks }
    : undefined;
}

function TaskStatusIcon({ status }: { status: ThreadSubAgentTask["status"] }) {
  if (status === "completed") {
    return <Check className="size-3.5 text-emerald-400" aria-hidden="true" />;
  }
  if (status === "failed") {
    return <CircleAlert className="size-3.5 text-amber-400" aria-hidden="true" />;
  }
  return <Circle className="size-3.5 fill-foreground/75 text-foreground/75" aria-hidden="true" />;
}

export function ThreadSubAgentActivityPanel({
  activity,
}: {
  activity: ThreadSubAgentActivity;
}) {
  const [expandedOverride, setExpandedOverride] = useState<boolean>();
  const [dismissed, setDismissed] = useState(false);
  const completedCount = activity.tasks.filter((task) => task.status === "completed").length;
  const failedCount = activity.tasks.filter((task) => task.status === "failed").length;
  const runningCount = activity.tasks.length - completedCount - failedCount;
  const expanded = expandedOverride ?? runningCount > 0;
  const currentTask = activity.tasks.find((task) => task.status === "running")
    ?? activity.tasks.at(-1);
  const summary = runningCount > 0
    ? `${runningCount} running`
    : failedCount > 0
      ? `${completedCount} complete, ${failedCount} failed`
      : `${completedCount}/${activity.tasks.length} complete`;

  if (dismissed) return null;

  return (
    <div className="autopr-sub-agent-activity relative z-0 -mb-px mx-3 overflow-hidden rounded-t-[16px] border border-b-0">
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`Sub-agents: ${summary}`}
          className="flex h-9 min-w-0 flex-1 items-center gap-2 px-3 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/45"
          onClick={() => setExpandedOverride(!expanded)}
        >
          <Network className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="shrink-0 font-medium text-foreground/90">Sub-agents</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
            {currentTask?.description}
          </span>
          <span className="shrink-0 font-mono tabular-nums text-muted-foreground/80">
            {summary}
          </span>
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 transition-transform motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          aria-label="Dismiss sub-agent activity"
          className="mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-muted-foreground/60 transition-colors hover:bg-muted/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
          onClick={() => setDismissed(true)}
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      </div>

      {expanded ? (
        <ul className="max-h-36 list-none overflow-y-auto border-t border-border/45 px-3 py-1.5">
          {activity.tasks.map((task) => (
            <li
              key={task.id}
              className="flex min-h-7 items-center gap-2 font-mono text-[11px]"
            >
              <TaskStatusIcon status={task.status} />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  task.status === "running"
                    ? "text-foreground/90"
                    : "text-muted-foreground/65",
                )}
              >
                {task.description}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground/55">
                {task.status === "running" ? "working" : task.status === "completed" ? "done" : "failed"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
