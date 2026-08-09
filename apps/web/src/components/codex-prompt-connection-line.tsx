import { cn } from "@autopr/ui/lib/utils";

export type CodexPromptConnectionIssue = "disconnected" | "unavailable";

const labels: Record<CodexPromptConnectionIssue, string> = {
  disconnected: "Connect ChatGPT or Grok before sending a prompt.",
  unavailable: "Could not verify a model connection.",
};

export function CodexPromptConnectionLine({
  issue,
  className,
}: {
  issue?: CodexPromptConnectionIssue;
  className?: string;
}) {
  if (!issue) {
    return null;
  }

  const unavailable = issue === "unavailable";

  return (
    <div
      role={unavailable ? "alert" : "status"}
      className={cn(
        "flex min-h-7 items-center gap-2 border-b border-border/70 bg-muted/25 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground",
        unavailable && "bg-destructive/5 text-destructive",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0",
          unavailable ? "bg-destructive" : "bg-[color:var(--cohere-coral)]",
        )}
      />
      <span className="min-w-0 leading-tight">{labels[issue]}</span>
    </div>
  );
}
