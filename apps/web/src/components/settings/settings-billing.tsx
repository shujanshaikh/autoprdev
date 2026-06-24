import { cn } from "@autopr/ui/lib/utils";
import type { WorkspaceSandboxCost } from "./settings-dialog";

interface SettingsBillingProps {
  sandboxCosts: WorkspaceSandboxCost[] | undefined;
}

const statusConfig = {
  active: {
    dot: "bg-emerald-500",
    text: "text-emerald-400",
    label: "Active",
  },
  pending_finalization: {
    dot: "bg-amber-500",
    text: "text-amber-400",
    label: "Finalizing",
  },
  finalized: {
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
    label: "Finalized",
  },
} as const;

export function SettingsBilling({ sandboxCosts }: SettingsBillingProps) {
  const totalSpend =
    sandboxCosts?.reduce((sum, row) => {
      const cost = row.finalTotalPrice ?? row.latestTotalPrice ?? 0;
      return sum + cost;
    }, 0) ?? 0;

  const activeCount =
    sandboxCosts?.filter((r) => r.status === "active").length ?? 0;
  const finalizedCount =
    sandboxCosts?.filter((r) => r.status === "finalized").length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Total Spend"
          value={`$${totalSpend.toFixed(4)}`}
          loading={sandboxCosts === undefined}
        />
        <SummaryCard
          label="Active"
          value={activeCount}
          loading={sandboxCosts === undefined}
        />
        <SummaryCard
          label="Finalized"
          value={finalizedCount}
          loading={sandboxCosts === undefined}
        />
      </div>

      <section className="min-w-0 border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <h2 className="min-w-0 font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            Sandbox costs
          </h2>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70">
            {sandboxCosts ? `${sandboxCosts.length} sandboxes` : "loading"}
          </span>
        </div>
        <div className="max-h-72 divide-y divide-border/60 overflow-y-auto minimal-scrollbar">
          {sandboxCosts === undefined ? (
            <div className="flex min-h-28 items-center justify-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" />
              Loading billing data
            </div>
          ) : sandboxCosts.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No billing history yet.
              </p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Costs appear here after a sandbox becomes ready.
              </p>
            </div>
          ) : (
            sandboxCosts.map((row) => (
              <BillingRow key={row._id} row={row} />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: string | number;
  loading: boolean;
}) {
  return (
    <div className="min-w-0 border border-border bg-muted/30 px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      {loading ? (
        <div className="mt-2 h-7 w-16 animate-pulse bg-muted" />
      ) : (
        <p className="mt-2 truncate text-xl font-semibold tabular-nums">{value}</p>
      )}
    </div>
  );
}

function BillingRow({ row }: { row: WorkspaceSandboxCost }) {
  const config = statusConfig[row.status];
  const cost = row.finalTotalPrice ?? row.latestTotalPrice;
  const costDisplay =
    cost === undefined ? "—" : `$${cost.toFixed(4)}`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/30 sm:grid-cols-[minmax(0,1fr)_7rem_6rem_10rem]">
      <div className="min-w-0">
        <p className="truncate font-mono text-[13px]">
          {row.repoFullName ?? row.sandboxName ?? "Unnamed sandbox"}
        </p>
      </div>

      {/* Status */}
      <div className="hidden items-center gap-2 sm:flex">
        <span
          className={cn("inline-block size-[6px] shrink-0 rounded-full", config.dot)}
          aria-hidden="true"
        />
        <span
          className={cn(
            "font-mono text-[10px] uppercase tracking-[0.16em]",
            config.text,
          )}
        >
          {config.label}
        </span>
      </div>

      <span className="hidden font-mono text-[13px] tabular-nums sm:block">
        {costDisplay}
      </span>

      <div className="flex items-center justify-end gap-0 sm:justify-start">
        <div className="flex items-center gap-2 sm:hidden">
          <span
            className={cn(
              "inline-block size-[5px] shrink-0 rounded-full",
              config.dot,
            )}
            aria-hidden="true"
          />
          <span className="font-mono text-[12px] tabular-nums">
            {costDisplay}
          </span>
        </div>
        <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
          {formatDate(row.sandboxCreatedAt)}
          {row.deletedAt ? ` → ${formatDate(row.deletedAt)}` : ""}
        </span>
      </div>
    </div>
  );
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
}
