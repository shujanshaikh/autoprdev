import { Check, CircleAlert, Clock3, ExternalLink, Minus } from "lucide-react";
import { useProjectPullRequestChecks } from "#/lib/project-pull-requests";

const PRESENTATION = {
  success: { Icon: Check, tone: "text-emerald-400", label: "Passed" },
  failure: { Icon: CircleAlert, tone: "text-red-400", label: "Failed" },
  pending: { Icon: Clock3, tone: "text-amber-400", label: "Pending" },
  neutral: { Icon: Minus, tone: "text-muted-foreground", label: "Skipped / neutral" },
};

export function PullRequestChecks({ projectId, number, headSha, htmlUrl }: { projectId: string; number: number; headSha: string; htmlUrl: string }) {
  const query = useProjectPullRequestChecks(projectId, number, headSha);
  const checks = query.data?.checks ?? [];
  const failed = checks.filter((check) => check.status === "failure").length;
  const pending = checks.filter((check) => check.status === "pending").length;
  const passed = checks.filter((check) => check.status === "success").length;

  return (
    <section className="border-b border-border/60 px-4 py-3" aria-label="Checks">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <h2 className="font-medium text-white">Checks</h2>
        {checks.length > 0 ? <span className="min-w-0 flex-1 text-muted-foreground">{passed} passed{failed ? ` · ${failed} failed` : ""}{pending ? ` · ${pending} pending` : ""}</span> : null}
        <a href={`${htmlUrl}/checks`} target="_blank" rel="noreferrer" className="ml-auto text-muted-foreground hover:text-white" aria-label="Open checks on GitHub"><ExternalLink className="size-3" /></a>
      </div>
      {query.isPending ? <p role="status" className="text-xs text-muted-foreground">Loading checks…</p> : query.error ? (
        <div className="flex flex-wrap items-center gap-2 text-xs" role="alert"><span className="text-muted-foreground">Checks unavailable.</span><button type="button" onClick={() => void query.refetch()} className="text-white underline underline-offset-4">Retry</button></div>
      ) : checks.length === 0 ? <p className="text-xs text-muted-foreground">No checks reported.</p> : (
        <ul className="divide-y divide-border/40">
          {checks.map((check) => {
            const { Icon, tone, label } = PRESENTATION[check.status];
            return (
              <li key={check.id} className="flex items-center gap-2 py-2 text-xs" title={check.description}>
                <Icon className={`size-3.5 shrink-0 ${tone}`} aria-hidden="true" />
                {check.url ? <a href={check.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-white hover:underline">{check.name}</a> : <span className="min-w-0 flex-1 truncate text-white">{check.name}</span>}
                <span className={`shrink-0 text-[11px] ${tone}`}>{label}</span>
              </li>
            );
          })}
        </ul>
      )}
      {query.data?.truncated ? <p className="mt-2 text-xs text-amber-400">Showing a partial list. Open GitHub for all checks.</p> : null}
    </section>
  );
}
