"use client";

export function DiffStatBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = Math.max(1, additions + deletions);
  const addPct = (additions / total) * 100;
  const delPct = (deletions / total) * 100;

  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-[3px] flex-1 overflow-hidden rounded-full bg-border/30">
        <span
          className="block h-full rounded-l-full bg-emerald-500/75 transition-[width] duration-500 ease-out"
          style={{ width: `${addPct}%` }}
        />
        <span
          className="block h-full rounded-r-full bg-red-500/60 transition-[width] duration-500 ease-out"
          style={{ width: `${delPct}%` }}
        />
      </div>
      <span className="font-mono text-[10px] tabular-nums text-emerald-600 dark:text-emerald-400">+{additions}</span>
      <span className="font-mono text-[10px] tabular-nums text-red-600 dark:text-red-400">−{deletions}</span>
    </div>
  );
}
