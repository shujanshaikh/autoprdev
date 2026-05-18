interface SandboxCost {
  _id: string;
  projectId: string;
  sandboxId: string;
  sandboxName?: string;
  repoFullName?: string;
  status: "active" | "pending_finalization" | "finalized";
  latestTotalPrice?: number;
  finalTotalPrice?: number;
  sandboxCreatedAt: number;
  deletedAt?: number;
}

export function BillingHistory({ rows }: { rows: SandboxCost[] | undefined }) {
  return (
    <section className="shrink-0 border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Billing history</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70">
          {rows ? `${rows.length} sandboxes` : "loading"}
        </span>
      </div>
      <div className="max-h-44 divide-y divide-border overflow-y-auto">
        {(rows ?? []).map((row) => (
          <div key={row._id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_7rem_8rem_10rem]">
            <div className="min-w-0">
              <p className="truncate font-mono">{row.repoFullName ?? row.sandboxName ?? "Unnamed sandbox"}</p>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {row.status === "pending_finalization" ? "finalizing" : row.status}
            </span>
            <span className="font-mono">
              {row.finalTotalPrice === undefined
                ? row.latestTotalPrice === undefined ? "—" : `$${row.latestTotalPrice.toFixed(4)}`
                : `$${row.finalTotalPrice.toFixed(4)}`}
            </span>
            <span className="hidden font-mono text-[10px] text-muted-foreground sm:block">
              {new Date(row.sandboxCreatedAt).toLocaleDateString()}
              {row.deletedAt ? ` → ${new Date(row.deletedAt).toLocaleDateString()}` : ""}
            </span>
          </div>
        ))}
        {rows?.length === 0 ? (
          <p className="px-4 py-4 text-xs text-muted-foreground">Costs appear here after a sandbox becomes ready.</p>
        ) : null}
      </div>
    </section>
  );
}
