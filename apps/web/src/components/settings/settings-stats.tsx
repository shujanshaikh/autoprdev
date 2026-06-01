import { cn } from "@autopr/ui/lib/utils";
import { Skeleton } from "@autopr/ui/components/skeleton";
import type { WorkspaceProject, WorkspaceSandboxCost } from "./settings-dialog";

interface SettingsStatsProps {
  projects: WorkspaceProject[] | undefined;
  sandboxCosts: WorkspaceSandboxCost[] | undefined;
}

export function SettingsStats({ projects, sandboxCosts }: SettingsStatsProps) {
  const projectCount = projects?.length ?? 0;
  const readyCount =
    projects?.filter((p) => p.sandboxStatus === "ready").length ?? 0;
  const runningCount =
    projects?.filter((p) => p.sandboxRuntimeStatus === "started").length ?? 0;

  const totalSpend =
    sandboxCosts?.reduce((sum, row) => {
      const cost = row.finalTotalPrice ?? row.latestTotalPrice ?? 0;
      return sum + cost;
    }, 0) ?? 0;

  const loading = projects === undefined;

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Total"
        value={projectCount}
        loading={loading}
        accent="border-l-primary"
        delay={0}
      />
      <StatCard
        label="Ready"
        value={readyCount}
        loading={loading}
        accent="border-l-emerald-500"
        delay={1}
      />
      <StatCard
        label="Running"
        value={runningCount}
        loading={loading}
        accent="border-l-amber-500"
        delay={2}
      />
      <StatCard
        label="Total Spend"
        value={`$${totalSpend.toFixed(2)}`}
        loading={sandboxCosts === undefined}
        accent="border-l-sky-500"
        delay={3}
        isCurrency
      />
    </section>
  );
}

function StatCard({
  label,
  value,
  loading,
  accent,
  delay,
  isCurrency,
}: {
  label: string;
  value: number | string;
  loading: boolean;
  accent: string;
  delay: number;
  isCurrency?: boolean;
}) {
  return (
    <div
      className={cn(
        "border border-border border-l-[3px] bg-card px-4 py-3 transition-all",
        "animate-[settingsCardIn_0.35s_ease-out_both]",
        accent,
      )}
      style={{ animationDelay: `${delay * 70}ms` }}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      {loading ? (
        <Skeleton className="mt-2 h-9 w-20" />
      ) : (
        <p
          className={cn(
            "mt-2 font-semibold tabular-nums",
            isCurrency ? "text-2xl" : "text-3xl",
          )}
        >
          {value}
        </p>
      )}
    </div>
  );
}
